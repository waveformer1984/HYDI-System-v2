"""Tests for core.task_engine"""
from __future__ import annotations

import threading
import time

import pytest

from core.schemas import Task, TaskPriority, TaskResult, TaskStatus
from core.task_engine import TaskEngine


def ok_handler(task: Task) -> TaskResult:
    return TaskResult(success=True, output={"done": True})


def fail_handler(task: Task) -> TaskResult:
    return TaskResult(success=False, error="intentional failure")


def raise_handler(task: Task) -> TaskResult:
    raise RuntimeError("boom")


class TestTaskEngineSubmit:
    def test_submit_returns_task_id(self):
        engine = TaskEngine(max_workers=0)
        t = Task.create("noop")
        tid = engine.submit(t)
        assert tid == t.task_id

    def test_submitted_task_is_queued(self):
        engine = TaskEngine(max_workers=0)
        t = Task.create("noop")
        engine.submit(t)
        assert engine.get(t.task_id).status == TaskStatus.QUEUED.value

    def test_cancel_queued_task(self):
        engine = TaskEngine(max_workers=0)
        t = Task.create("noop")
        engine.submit(t)
        assert engine.cancel(t.task_id) is True
        assert engine.get(t.task_id).status == TaskStatus.CANCELLED.value

    def test_cancel_unknown_task_returns_false(self):
        engine = TaskEngine(max_workers=0)
        assert engine.cancel("nonexistent") is False


class TestTaskEngineExecution:
    def _run(self, handler, task_type="job", max_retries=1, workers=2, wait=2.0):
        engine = TaskEngine(max_workers=workers, retry_base_seconds=0.01)
        engine.register(task_type, handler)
        engine.start()
        t = Task.create(task_type, max_retries=max_retries)
        engine.submit(t)
        deadline = time.time() + wait
        while time.time() < deadline:
            task = engine.get(t.task_id)
            if task.status in (TaskStatus.SUCCEEDED.value, TaskStatus.FAILED.value, TaskStatus.CANCELLED.value):
                break
            time.sleep(0.05)
        engine.stop(drain_timeout=1.0)
        return engine.get(t.task_id)

    def test_successful_task_status(self):
        task = self._run(ok_handler)
        assert task.status == TaskStatus.SUCCEEDED.value

    def test_successful_task_result_output(self):
        task = self._run(ok_handler)
        assert task.result.output == {"done": True}

    def test_failed_handler_sets_failed_status(self):
        task = self._run(fail_handler, max_retries=1)
        assert task.status == TaskStatus.FAILED.value

    def test_exception_handler_retries_then_fails(self):
        task = self._run(raise_handler, max_retries=2, wait=3.0)
        assert task.status == TaskStatus.FAILED.value
        assert task.attempts >= 2

    def test_no_handler_fails_immediately(self):
        engine = TaskEngine(max_workers=2)
        engine.start()
        t = Task.create("unknown_type")
        engine.submit(t)
        time.sleep(0.5)
        engine.stop(drain_timeout=1.0)
        task = engine.get(t.task_id)
        assert task.status == TaskStatus.FAILED.value


class TestDependencies:
    def test_dependent_task_waits_for_parent(self):
        engine = TaskEngine(max_workers=2, retry_base_seconds=0.01)
        order = []

        def record(label):
            def h(task):
                order.append(label)
                return TaskResult(success=True)
            return h

        engine.register("parent", record("parent"))
        engine.register("child", record("child"))
        engine.start()

        parent = Task.create("parent")
        child = Task.create("child", depends_on=[parent.task_id])
        engine.submit(parent)
        engine.submit(child)

        time.sleep(1.5)
        engine.stop(drain_timeout=1.0)

        assert order.index("parent") < order.index("child")


class TestStats:
    def test_stats_returns_dict(self):
        engine = TaskEngine(max_workers=0)
        t = Task.create("noop")
        engine.submit(t)
        s = engine.stats()
        assert TaskStatus.QUEUED.value in s
        assert s[TaskStatus.QUEUED.value] == 1
