"""PROTOFORGE SAFETY & PERMISSIONS

Action-level gating with risk classification, confirmation levels,
immutable audit trail, and rollback registry.
"""
from __future__ import annotations

import json
import logging
import time
import uuid
from dataclasses import dataclass, asdict, field
from enum import Enum
from typing import Any, Callable, Dict, List, Optional

logger = logging.getLogger("ProtoForge.Safety")


class RiskLevel(str, Enum):
    LOW    = "low"     # auto-run
    MEDIUM = "medium"  # ask for confirmation
    HIGH   = "high"    # require explicit authorization


class ActionScope(str, Enum):
    FILE_READ    = "file.read"
    FILE_WRITE   = "file.write"
    FILE_DELETE  = "file.delete"
    SHELL_EXEC   = "shell.execute"
    API_CALL     = "api.call"
    DB_READ      = "db.read"
    DB_WRITE     = "db.write"
    DB_DELETE    = "db.delete"
    NETWORK_SEND = "network.send"
    SYSTEM_CFG   = "system.configure"


SCOPE_RISK: Dict[str, str] = {
    ActionScope.FILE_READ.value:    RiskLevel.LOW.value,
    ActionScope.FILE_WRITE.value:   RiskLevel.MEDIUM.value,
    ActionScope.FILE_DELETE.value:  RiskLevel.HIGH.value,
    ActionScope.SHELL_EXEC.value:   RiskLevel.HIGH.value,
    ActionScope.API_CALL.value:     RiskLevel.MEDIUM.value,
    ActionScope.DB_READ.value:      RiskLevel.LOW.value,
    ActionScope.DB_WRITE.value:     RiskLevel.MEDIUM.value,
    ActionScope.DB_DELETE.value:    RiskLevel.HIGH.value,
    ActionScope.NETWORK_SEND.value: RiskLevel.MEDIUM.value,
    ActionScope.SYSTEM_CFG.value:   RiskLevel.HIGH.value,
}


@dataclass
class AuditRecord:
    audit_id:   str            = field(default_factory=lambda: str(uuid.uuid4()))
    timestamp:  float          = field(default_factory=time.time)
    actor:      str            = ""
    scope:      str            = ""
    action:     str            = ""
    risk_level: str            = ""
    decision:   str            = ""   # "allowed" | "denied"
    reason:     Optional[str]  = None
    metadata:   Dict[str, Any] = field(default_factory=dict)

    def to_json(self) -> str:
        return json.dumps(asdict(self))


class PermissionSystem:
    """
    Action-level permission gate.

    Decision matrix
    ---------------
    LOW risk    → auto-allow if scope is granted
    MEDIUM risk → call confirmation handler (auto-allow if none configured)
    HIGH risk   → must have confirmation handler; deny if missing

    Audit trail is append-only and never pruned in this implementation.
    """

    def __init__(self) -> None:
        self._granted:      Dict[str, List[str]]              = {}
        self._audit:        List[AuditRecord]                 = []
        self._confirm:      Optional[Callable[[str, str, str], bool]] = None
        self._rollbacks:    Dict[str, Callable[[], None]]     = {}

    # ------------------------------------------------------------------
    # Grant / revoke
    # ------------------------------------------------------------------

    def grant(self, actor: str, *scopes: str) -> None:
        self._granted.setdefault(actor, [])
        for scope in scopes:
            if scope not in self._granted[actor]:
                self._granted[actor].append(scope)
        logger.info("Granted %s → %s", actor, scopes)

    def revoke(self, actor: str, *scopes: str) -> None:
        for scope in scopes:
            try:
                self._granted.get(actor, []).remove(scope)
            except ValueError:
                pass
        logger.info("Revoked %s → %s", actor, scopes)

    def set_confirmation_handler(self, handler: Callable[[str, str, str], bool]) -> None:
        """Handler signature: (actor, scope, action) → bool."""
        self._confirm = handler

    # ------------------------------------------------------------------
    # Permission check
    # ------------------------------------------------------------------

    def check(
        self,
        actor: str,
        scope: str,
        action: str,
        metadata: Optional[Dict[str, Any]] = None,
    ) -> bool:
        granted_scopes = self._granted.get(actor, [])
        risk = SCOPE_RISK.get(scope, RiskLevel.HIGH.value)

        if scope not in granted_scopes:
            self._record(actor, scope, action, risk, "denied", "scope not granted", metadata)
            logger.warning("DENIED %s scope=%s (not granted)", actor, scope)
            return False

        if risk == RiskLevel.LOW.value:
            self._record(actor, scope, action, risk, "allowed", None, metadata)
            return True

        if risk == RiskLevel.MEDIUM.value:
            if self._confirm is not None:
                ok = self._confirm(actor, scope, action)
                self._record(actor, scope, action, risk, "allowed" if ok else "denied", None, metadata)
                return ok
            self._record(actor, scope, action, risk, "allowed", "no confirmation handler", metadata)
            return True

        # HIGH risk
        if self._confirm is not None:
            ok = self._confirm(actor, scope, action)
            reason = None if ok else "operator denied high-risk action"
            self._record(actor, scope, action, risk, "allowed" if ok else "denied", reason, metadata)
            return ok

        self._record(actor, scope, action, risk, "denied", "high-risk: no confirmation handler configured", metadata)
        logger.error("DENIED high-risk %s scope=%s (no handler)", actor, scope)
        return False

    # ------------------------------------------------------------------
    # Rollback registry
    # ------------------------------------------------------------------

    def register_rollback(self, operation_id: str, fn: Callable[[], None]) -> None:
        self._rollbacks[operation_id] = fn

    def rollback(self, operation_id: str) -> bool:
        fn = self._rollbacks.pop(operation_id, None)
        if fn is None:
            logger.warning("No rollback for: %s", operation_id)
            return False
        try:
            fn()
            logger.info("Rolled back: %s", operation_id)
            return True
        except Exception as exc:
            logger.error("Rollback failed %s: %s", operation_id, exc)
            return False

    # ------------------------------------------------------------------
    # Audit
    # ------------------------------------------------------------------

    def _record(
        self,
        actor: str, scope: str, action: str, risk: str,
        decision: str, reason: Optional[str],
        metadata: Optional[Dict[str, Any]],
    ) -> None:
        self._audit.append(AuditRecord(
            actor=actor, scope=scope, action=action,
            risk_level=risk, decision=decision, reason=reason,
            metadata=metadata or {},
        ))

    def audit_log(
        self,
        actor: Optional[str] = None,
        scope: Optional[str] = None,
        decision: Optional[str] = None,
        limit: int = 200,
    ) -> List[AuditRecord]:
        records = self._audit
        if actor:
            records = [r for r in records if r.actor == actor]
        if scope:
            records = [r for r in records if r.scope == scope]
        if decision:
            records = [r for r in records if r.decision == decision]
        return records[-limit:]
