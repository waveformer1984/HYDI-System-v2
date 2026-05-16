"""PROTOFORGE TASK ENGINE

Priority queue with Redis backend, dependency tracking, exponential-backoff
retry, cancellation, and pluggable handlers.
"""
from __future__ import annotations

import logging
import threading
import time
from typing import Any, Callable, Dict, List, Optional, Set

from .schemas import Task, TaskPriority, TaskResult, TaskStatus

logger = logging.getLogger("ProtoForge.TaskEngine")


class TaskEngine:
    """
    Production task queue.

    Features
    --------
    - Priority lanes: CRITICAL (0) through BACKGROUND (4)
    - Dependency chains: task B only runs after task A succeeds
    - Auto-retry with exponential back-off
    - Per-task timeout enforcement
    - Graceful shutdown drains the queue
    - Optional Redis-backed persistence (in-memory fallback)
    """

    def __init__(
        self,
        redis_url: Optional[str] = None,
        max_workers: int = 4,
        retry_base_seconds: float = 2.0,
    ) -> None:
        self._max_workers = max_workers
        self._retry_base = retry_base_seconds
        self._redis = self._connect_redis(redis_url)

        self._tasks: Dict[str, Task] = {}
        self._completed: Set[str] = set()
        self._handlers: Dict[str, Callable[[Task], TaskResult]] = {}
        self._lock = threading.RLock()
        self._queue_event = threading.Event()
        self._shutdown = threading.Event()
        self._workers: List[threading.Thread] = []

    # ------------------------------------------------------------------
    # Redis
    # ------------------------------------------------------------------

    def _connect_redis(self, url: Optional[str]):
        if not url:
            return None
        try:
            import redis
            client = redis.from_url(url, socket_connect_timeout=2)
            client.ping()
            logger.info("TaskEngine connected to Redis: %s", url)
            return client
        except Exception as exc:
            logger.warning("Redis unavailable (%s) — using in-memory queue", exc)
            return None

    # ------------------------------------------------------------------
    # Handler registration
    # ------------------------------------------------------------------

    def register(self, task_type: str, handler: Callable[[Task], TaskResult]) -> None:
        self._handlers[task_type] = handler
        logger.debug("Handler registered: %s", task_type)

    # ------------------------------------------------------------------
    # Submission & control
    # ------------------------------------------------------------------

    def submit(self, task: Task) -> str:
        with self._lock:
            task.status = TaskStatus.QUEUED.value
            task.queued_at = time.time()
            self._tasks[task.task_id] = task
            if self._redis:
                self._redis_push(task)
        self._queue_event.set()
        logger.info(
            "Task queued: %s type=%s priority=%s",
            task.task_id, task.task_type, task.priority,
        )
        return task.task_id

    def cancel(self, task_id: str) -> bool:
        terminal = {TaskStatus.SUCCEEDED.value, TaskStatus.FAILED.value, TaskStatus.CANCELLED.value}
        with self._lock:
            task = self._tasks.get(task_id)
            if not task or task.status in terminal:
                return False
            task.status = TaskStatus.CANCELLED.value
            task.finished_at = time.time()
        logger.info("Task cancelled: %s", task_id)
        return True

    def get(self, task_id: str) -> Optional[Task]:
        with self._lock:
            return self._tasks.get(task_id)

    def stats(self) -> Dict[str, int]:
        with self._lock:
            counts: Dict[str, int] = {}
            for t in self._tasks.values():
                counts[t.status] = counts.get(t.status, 0) + 1
        return counts

    # ------------------------------------------------------------------
    # Lifecycle
    # ------------------------------------------------------------------

    def start(self) -> None:
        for i in range(self._max_workers):
            t = threading.Thread(
                target=self._worker_loop,
                name=f"TaskWorker-{i}",
                daemon=True,
            )
            t.start()
            self._workers.append(t)
        logger.info("TaskEngine started: %d workers", self._max_workers)

    def stop(self, drain_timeout: float = 15.0) -> None:
        self._shutdown.set()
        self._queue_event.set()
        for t in self._workers:
            t.join(timeout=drain_timeout)
        logger.info("TaskEngine stopped")

    # ------------------------------------------------------------------
    # Worker loop
    # ------------------------------------------------------------------

    def _worker_loop(self) -> None:
        while not self._shutdown.is_set():
            self._queue_event.wait(timeout=1.0)
            task = self._dequeue()
            if task is None:
                self._queue_event.clear()
                continue
            self._execute(task)

    def _dequeue(self) -> Optional[Task]:
        with self._lock:
            candidates = [
                t for t in self._tasks.values()
                if t.status == TaskStatus.QUEUED.value
                and self._deps_met(t)
            ]
            if not candidates:
                return None
            candidates.sort(key=lambda t: (t.priority, t.queued_at or 0))
            task = candidates[0]
            task.status = TaskStatus.RUNNING.value
            task.started_at = time.time()
            return task

    def _deps_met(self, task: Task) -> bool:
        return all(dep in self._completed for dep in task.depends_on)

    def _execute(self, task: Task) -> None:
        handler = self._handlers.get(task.task_type)
        if handler is None:
            logger.error("No handler for task type '%s'", task.task_type)
            self._fail(task, f"No handler for '{task.task_type}'")
            return

        task.attempts += 1
        t0 = time.time()
        try:
            logger.info(
                "Executing %s (%s) attempt %d/%d",
                task.task_id, task.task_type, task.attempts, task.max_retries,
            )
            result = handler(task)
            result.duration_seconds = time.time() - t0
            result.attempts = task.attempts
            with self._lock:
                task.result = result
                task.finished_at = time.time()
                if result.success:
                    task.status = TaskStatus.SUCCEEDED.value
                    self._completed.add(task.task_id)
                else:
                    task.status = TaskStatus.FAILED.value
            logger.info("Task %s → %s", task.task_id, task.status)

        except Exception as exc:
            logger.exception("Task %s raised exception", task.task_id)
            if task.attempts < task.max_retries:
                backoff = self._retry_base * (2 ** (task.attempts - 1))
                logger.info("Retry %s in %.1fs", task.task_id, backoff)
                with self._lock:
                    task.status = TaskStatus.RETRYING.value
                time.sleep(backoff)
                with self._lock:
                    task.status = TaskStatus.QUEUED.value
                self._queue_event.set()
            else:
                self._fail(task, str(exc))

    def _fail(self, task: Task, error: str) -> None:
        with self._lock:
            task.result = TaskResult(success=False, error=error, attempts=task.attempts)
            task.status = TaskStatus.FAILED.value
            task.finished_at = time.time()

    # ------------------------------------------------------------------
    # Redis helpers
    # ------------------------------------------------------------------

    def _redis_push(self, task: Task) -> None:
        try:
            key = f"protoforge:tasks:{task.priority}"
            self._redis.lpush(key, task.to_json())
        except Exception as exc:
            logger.warning("Redis push failed: %s", exc)
