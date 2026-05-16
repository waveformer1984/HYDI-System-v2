"""HYDI adapter for the Rezonate DAW federation node."""

from __future__ import annotations

import json
import logging
import time
import uuid
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional

logger = logging.getLogger("HYDI.RezonateAdapter")

_CONFIG_PATH = Path(__file__).parent / "config.json"


def _load_config() -> Dict[str, Any]:
    try:
        return json.loads(_CONFIG_PATH.read_text())
    except Exception as exc:  # pragma: no cover
        logger.warning("Could not load rezonate node config: %s", exc)
        return {}


class RezonateAdapter:
    """
    HYDI adapter for a Rezonate DAW node.

    Responsibilities:
    - Maintain the node's identity and capability manifest within HYDI.
    - Dispatch tasks to the Rezonate node and collect results.
    - Poll and broadcast health reports.
    - Observe and relay status changes.

    The adapter is deliberately transport-agnostic: callers supply
    send/receive callables so the same adapter works over HTTP, WebSockets,
    gRPC, or in-process stubs.
    """

    def __init__(
        self,
        node_id: Optional[str] = None,
        endpoint: Optional[str] = None,
        send: Optional[Callable[[str, Dict[str, Any]], Dict[str, Any]]] = None,
    ) -> None:
        self.config = _load_config()
        self.node_id = node_id or str(uuid.uuid4())
        self.endpoint = endpoint
        self._send = send or self._noop_send
        self._last_health: Optional[Dict[str, Any]] = None
        self._last_health_at: float = 0.0
        self._task_results: Dict[str, Dict[str, Any]] = {}
        self._status_listeners: List[Callable[[str], None]] = []
        logger.info("RezonateAdapter ready: node_id=%s endpoint=%s", self.node_id, endpoint)

    # ------------------------------------------------------------------
    # Identity & capabilities
    # ------------------------------------------------------------------

    def get_node_manifest(self) -> Dict[str, Any]:
        """Return the node manifest HYDI uses for routing and scoring."""
        return {
            "node_id": self.node_id,
            "node_type": self.config.get("node_type", "rezonate"),
            "display_name": self.config.get("display_name", "Rezonate DAW Node"),
            "version": self.config.get("version", "1.0.0"),
            "hydi_compatible": self.config.get("hydi_compatible", True),
            "protoforge_node": self.config.get("protoforge_node", True),
            "capabilities": self.config.get("capabilities", {}),
            "accepted_task_types": self.config.get("accepted_task_types", []),
            "federation": self.config.get("federation", {}),
        }

    def supports_task_type(self, task_type: str) -> bool:
        return task_type in self.config.get("accepted_task_types", [])

    # ------------------------------------------------------------------
    # Task dispatch
    # ------------------------------------------------------------------

    def dispatch_task(
        self,
        task_type: str,
        payload: Dict[str, Any],
        task_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        Dispatch a task to the Rezonate node.

        Returns the acknowledgement from the node, or an error dict if
        the task type is unsupported or the node is unreachable.
        """
        if not self.supports_task_type(task_type):
            logger.warning("Task type not supported by Rezonate: %s", task_type)
            return {"accepted": False, "reason": f"Unsupported task type: {task_type}"}

        tid = task_id or str(uuid.uuid4())
        message = {
            "task_id": tid,
            "type": task_type,
            "node_id": self.node_id,
            "dispatched_at": time.time(),
            "payload": payload,
        }

        logger.info("Dispatching task %s (%s) to Rezonate", tid, task_type)
        response = self._send("task_dispatch", message)
        self._task_results[tid] = response
        return response

    def get_task_result(self, task_id: str) -> Optional[Dict[str, Any]]:
        return self._task_results.get(task_id)

    # ------------------------------------------------------------------
    # Health polling
    # ------------------------------------------------------------------

    def poll_health(self, force: bool = False) -> Dict[str, Any]:
        """
        Poll the Rezonate node for a health report.

        Respects the configured interval unless *force* is True.
        """
        interval = self.config.get("health_report_interval_seconds", 30)
        now = time.time()

        if not force and self._last_health and (now - self._last_health_at) < interval:
            return self._last_health

        response = self._send("health_poll", {"node_id": self.node_id})
        self._last_health = response
        self._last_health_at = now
        logger.debug("Health polled: status=%s", response.get("status", "unknown"))
        return response

    @property
    def last_health(self) -> Optional[Dict[str, Any]]:
        return self._last_health

    # ------------------------------------------------------------------
    # Status observation
    # ------------------------------------------------------------------

    def on_status_change(self, listener: Callable[[str], None]) -> None:
        """Register a listener called whenever the node status changes."""
        self._status_listeners.append(listener)

    def notify_status_change(self, new_status: str) -> None:
        logger.info("Rezonate node status changed: %s", new_status)
        for listener in self._status_listeners:
            try:
                listener(new_status)
            except Exception as exc:
                logger.warning("Status listener error: %s", exc)

    def handle_event(self, event: Dict[str, Any]) -> None:
        """
        Handle an inbound event pushed from the Rezonate node.

        Currently handles ``status_change`` and ``health_update`` events;
        unknown events are logged and ignored.
        """
        event_type = event.get("type")

        if event_type == "status_change":
            self.notify_status_change(event.get("status", "unknown"))

        elif event_type == "health_update":
            self._last_health = event.get("report", {})
            self._last_health_at = time.time()
            logger.debug("Health update received from Rezonate node")

        elif event_type == "task_complete":
            tid = event.get("task_id")
            if tid:
                self._task_results[tid] = event.get("result", {})
                logger.info("Task completed: %s", tid)

        else:
            logger.debug("Unhandled Rezonate event type: %s", event_type)

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    @staticmethod
    def _noop_send(action: str, payload: Dict[str, Any]) -> Dict[str, Any]:
        """Default no-op transport — returns a stub acknowledgement."""
        logger.debug("[noop] %s: %s", action, list(payload.keys()))
        return {"accepted": True, "stub": True, "action": action}
