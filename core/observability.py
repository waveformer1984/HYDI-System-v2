"""PROTOFORGE OBSERVABILITY

Structured JSON logging, in-process metrics (Prometheus text export),
and a health-check aggregator.
"""
from __future__ import annotations

import json
import logging
import threading
import time
from collections import defaultdict, deque
from typing import Any, Dict, List, Optional, Tuple


# ── Structured logger ──────────────────────────────────────────────────────

class JsonFormatter(logging.Formatter):
    """Emits one JSON object per log line."""

    def format(self, record: logging.LogRecord) -> str:
        doc: Dict[str, Any] = {
            "ts":     record.created,
            "level":  record.levelname,
            "logger": record.name,
            "msg":    record.getMessage(),
        }
        if record.exc_info:
            doc["exc"] = self.formatException(record.exc_info)
        doc.update(getattr(record, "ctx", {}))
        return json.dumps(doc)


class StructuredLogger:
    """Thin wrapper that attaches a JsonFormatter and exposes log helpers."""

    def __init__(self, name: str, level: int = logging.INFO) -> None:
        self._log = logging.getLogger(name)
        self._log.setLevel(level)
        if not self._log.handlers:
            h = logging.StreamHandler()
            h.setFormatter(JsonFormatter())
            self._log.addHandler(h)

    def _emit(self, level: int, msg: str, **ctx: Any) -> None:
        self._log.log(level, msg, extra={"ctx": ctx} if ctx else {})

    def debug(self, msg: str, **ctx: Any) -> None:
        self._emit(logging.DEBUG, msg, **ctx)

    def info(self, msg: str, **ctx: Any) -> None:
        self._emit(logging.INFO, msg, **ctx)

    def warning(self, msg: str, **ctx: Any) -> None:
        self._emit(logging.WARNING, msg, **ctx)

    def error(self, msg: str, **ctx: Any) -> None:
        self._emit(logging.ERROR, msg, **ctx)


# ── Metrics collector ───────────────────────────────────────────────────

class MetricsCollector:
    """
    Thread-safe in-process metrics store.

    Supports counters, gauges, and histograms.
    Exports Prometheus text format via ``to_prometheus()``.
    """

    def __init__(self) -> None:
        self._counters:   Dict[str, float]            = defaultdict(float)
        self._gauges:     Dict[str, float]            = {}
        self._histograms: Dict[str, deque]            = defaultdict(lambda: deque(maxlen=1_000))
        self._lock = threading.Lock()

    @staticmethod
    def _key(name: str, labels: Optional[Dict[str, str]]) -> str:
        if not labels:
            return name
        label_str = ",".join(f'{k}="{v}"' for k, v in sorted(labels.items()))
        return f"{name}{{{label_str}}}"

    def increment(self, name: str, value: float = 1.0, labels: Optional[Dict[str, str]] = None) -> None:
        with self._lock:
            self._counters[self._key(name, labels)] += value

    def gauge(self, name: str, value: float, labels: Optional[Dict[str, str]] = None) -> None:
        with self._lock:
            self._gauges[self._key(name, labels)] = value

    def observe(self, name: str, value: float, labels: Optional[Dict[str, str]] = None) -> None:
        with self._lock:
            self._histograms[self._key(name, labels)].append(value)

    def to_prometheus(self) -> str:
        lines: List[str] = []
        with self._lock:
            for key, v in self._counters.items():
                base = key.split("{")[0]
                lines += [f"# TYPE {base} counter", f"{key} {v}"]
            for key, v in self._gauges.items():
                base = key.split("{")[0]
                lines += [f"# TYPE {base} gauge", f"{key} {v}"]
            for key, vals in self._histograms.items():
                if not vals:
                    continue
                base = key.split("{")[0]
                avg = sum(vals) / len(vals)
                lines += [
                    f"# TYPE {base} summary",
                    f"{base}_count {len(vals)}",
                    f"{base}_sum {sum(vals):.6f}",
                    f"{base}_avg {avg:.6f}",
                ]
        return "\n".join(lines)

    def snapshot(self) -> Dict[str, Any]:
        with self._lock:
            return {
                "counters":   dict(self._counters),
                "gauges":     dict(self._gauges),
                "histograms": {k: list(v)[-20:] for k, v in self._histograms.items()},
            }


# ── Health aggregator ─────────────────────────────────────────────────────

class HealthAggregator:
    """
    Collects health reports from all registered modules and surfaces
    a single system-level health verdict.
    """

    def __init__(self, stale_after_seconds: float = 90.0) -> None:
        self._reports: Dict[str, Tuple[float, Dict[str, Any]]] = {}
        self._lock = threading.Lock()
        self._stale_after = stale_after_seconds

    def record(self, module_id: str, report: Dict[str, Any]) -> None:
        with self._lock:
            self._reports[module_id] = (time.time(), report)

    def system_health(self) -> Dict[str, Any]:
        now = time.time()
        healthy, degraded, stale = [], [], []
        with self._lock:
            items = list(self._reports.items())
        for module_id, (ts, report) in items:
            if (now - ts) > self._stale_after:
                stale.append(module_id)
            elif report.get("status") == "online":
                healthy.append(module_id)
            else:
                degraded.append(module_id)

        overall = "healthy" if not degraded and not stale else ("degraded" if not stale else "critical")
        return {
            "overall":  overall,
            "healthy":  healthy,
            "degraded": degraded,
            "stale":    stale,
            "checked_at": now,
        }
