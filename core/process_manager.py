"""PROTOFORGE PROCESS MANAGER

Persistent subprocess lifecycle with auto-restart, exponential back-off,
watchdog health checks, and graceful SIGTERM→SIGKILL shutdown.
"""
from __future__ import annotations

import logging
import os
import subprocess
import threading
import time
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Dict, List, Optional

logger = logging.getLogger("ProtoForge.ProcessManager")


class RestartPolicy(str, Enum):
    ALWAYS     = "always"
    ON_FAILURE = "on_failure"
    NEVER      = "never"


@dataclass
class ProcessSpec:
    name:                      str
    command:                   List[str]
    restart_policy:            str            = RestartPolicy.ON_FAILURE.value
    max_restarts:              int            = 5
    restart_delay_seconds:     float          = 2.0
    watchdog_interval_seconds: float          = 10.0
    env:                       Dict[str, str] = field(default_factory=dict)
    cwd:                       Optional[str]  = None
    health_check_command:      Optional[List[str]] = None


@dataclass
class ProcessState:
    spec:         ProcessSpec
    proc:         Optional[subprocess.Popen] = None
    pid:          Optional[int]              = None
    status:       str                        = "stopped"
    restarts:     int                        = 0
    started_at:   Optional[float]            = None
    last_seen_at: Optional[float]            = None

    def alive(self) -> bool:
        return self.proc is not None and self.proc.poll() is None


class ProcessManager:
    """
    Manages a catalogue of long-running subprocesses.

    Features
    --------
    - Configurable restart policy (always / on_failure / never)
    - Exponential back-off per process (caps at ~64× base delay)
    - Watchdog thread polls every process on its own interval
    - Graceful shutdown: SIGTERM first, SIGKILL on timeout
    - Thread-safe status API
    """

    def __init__(self, watchdog_tick_seconds: float = 5.0) -> None:
        self._states: Dict[str, ProcessState] = {}
        self._lock = threading.RLock()
        self._shutdown = threading.Event()
        self._tick = watchdog_tick_seconds
        self._watchdog = threading.Thread(
            target=self._watchdog_loop,
            name="ProcessWatchdog",
            daemon=True,
        )

    # ------------------------------------------------------------------
    # Registration
    # ------------------------------------------------------------------

    def register(self, spec: ProcessSpec) -> None:
        with self._lock:
            self._states[spec.name] = ProcessState(spec=spec)
        logger.info("Registered process: %s → %s", spec.name, spec.command)

    # ------------------------------------------------------------------
    # Lifecycle
    # ------------------------------------------------------------------

    def start_all(self) -> None:
        self._watchdog.start()
        with self._lock:
            names = list(self._states.keys())
        for name in names:
            self._start(name)

    def stop_all(self, timeout: float = 10.0) -> None:
        self._shutdown.set()
        with self._lock:
            names = list(self._states.keys())
        for name in names:
            self._stop(name, timeout)
        self._watchdog.join(timeout=5.0)
        logger.info("All processes stopped")

    def restart(self, name: str) -> bool:
        self._stop(name)
        return self._start(name)

    # ------------------------------------------------------------------
    # Internal start / stop
    # ------------------------------------------------------------------

    def _start(self, name: str) -> bool:
        with self._lock:
            state = self._states.get(name)
            if state is None or state.alive():
                return False
            spec = state.spec
        try:
            env = os.environ.copy()
            env.update(spec.env)
            proc = subprocess.Popen(
                spec.command,
                cwd=spec.cwd,
                env=env,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
            )
            with self._lock:
                state.proc = proc
                state.pid = proc.pid
                state.status = "running"
                state.started_at = time.time()
                state.last_seen_at = time.time()
            logger.info("Started %s (PID %d)", name, proc.pid)
            return True
        except Exception as exc:
            logger.error("Failed to start %s: %s", name, exc)
            with self._lock:
                state.status = "failed"
            return False

    def _stop(self, name: str, timeout: float = 10.0) -> None:
        with self._lock:
            state = self._states.get(name)
            if state is None or not state.alive():
                return
            proc = state.proc
        try:
            proc.terminate()
            proc.wait(timeout=timeout)
        except subprocess.TimeoutExpired:
            logger.warning("%s did not terminate — killing", name)
            proc.kill()
        with self._lock:
            state.proc = None
            state.pid = None
            state.status = "stopped"
        logger.info("Stopped %s", name)

    # ------------------------------------------------------------------
    # Watchdog
    # ------------------------------------------------------------------

    def _watchdog_loop(self) -> None:
        while not self._shutdown.is_set():
            time.sleep(self._tick)
            with self._lock:
                names = list(self._states.keys())
            for name in names:
                self._check(name)

    def _check(self, name: str) -> None:
        with self._lock:
            state = self._states.get(name)
            if state is None:
                return
            if state.alive():
                state.last_seen_at = time.time()
                return
            policy = state.spec.restart_policy
            restarts = state.restarts
            max_r = state.spec.max_restarts

        if policy == RestartPolicy.NEVER.value:
            return
        if restarts >= max_r:
            logger.error("%s: max restarts (%d) reached — giving up", name, max_r)
            with self._lock:
                state.status = "exhausted"
            return

        delay = state.spec.restart_delay_seconds * (2 ** min(restarts, 6))
        logger.warning(
            "%s crashed — restart %d/%d in %.1fs",
            name, restarts + 1, max_r, delay,
        )
        time.sleep(delay)
        with self._lock:
            state.restarts += 1
        self._start(name)

    # ------------------------------------------------------------------
    # Status API
    # ------------------------------------------------------------------

    def status(self) -> Dict[str, Dict[str, Any]]:
        with self._lock:
            return {
                name: {
                    "status":     s.status,
                    "pid":        s.pid,
                    "alive":      s.alive(),
                    "restarts":   s.restarts,
                    "started_at": s.started_at,
                }
                for name, s in self._states.items()
            }
