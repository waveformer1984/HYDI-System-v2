"""Tests for core.safety.permissions"""
from __future__ import annotations

import pytest

from core.safety.permissions import ActionScope, AuditRecord, PermissionSystem, RiskLevel


class TestGrantRevoke:
    def test_grant_adds_scope(self):
        ps = PermissionSystem()
        ps.grant("agent_a", ActionScope.FILE_READ.value)
        assert ps.check("agent_a", ActionScope.FILE_READ.value, "open config.json") is True

    def test_ungrant_scope_is_denied(self):
        ps = PermissionSystem()
        assert ps.check("agent_a", ActionScope.FILE_READ.value, "open x") is False

    def test_revoke_removes_scope(self):
        ps = PermissionSystem()
        ps.grant("agent_a", ActionScope.FILE_READ.value)
        ps.revoke("agent_a", ActionScope.FILE_READ.value)
        assert ps.check("agent_a", ActionScope.FILE_READ.value, "open x") is False

    def test_grant_multiple_scopes(self):
        ps = PermissionSystem()
        ps.grant("agent_b", ActionScope.FILE_READ.value, ActionScope.DB_READ.value)
        assert ps.check("agent_b", ActionScope.FILE_READ.value, "read") is True
        assert ps.check("agent_b", ActionScope.DB_READ.value, "select") is True


class TestRiskLevels:
    def test_low_risk_auto_allowed(self):
        ps = PermissionSystem()
        ps.grant("agent", ActionScope.FILE_READ.value)
        assert ps.check("agent", ActionScope.FILE_READ.value, "cat file") is True

    def test_medium_risk_allowed_without_handler(self):
        ps = PermissionSystem()
        ps.grant("agent", ActionScope.FILE_WRITE.value)
        assert ps.check("agent", ActionScope.FILE_WRITE.value, "write file") is True

    def test_medium_risk_denied_by_handler(self):
        ps = PermissionSystem()
        ps.grant("agent", ActionScope.FILE_WRITE.value)
        ps.set_confirmation_handler(lambda a, s, x: False)
        assert ps.check("agent", ActionScope.FILE_WRITE.value, "write file") is False

    def test_high_risk_denied_without_handler(self):
        ps = PermissionSystem()
        ps.grant("agent", ActionScope.FILE_DELETE.value)
        assert ps.check("agent", ActionScope.FILE_DELETE.value, "rm -rf") is False

    def test_high_risk_allowed_by_handler(self):
        ps = PermissionSystem()
        ps.grant("agent", ActionScope.SHELL_EXEC.value)
        ps.set_confirmation_handler(lambda a, s, x: True)
        assert ps.check("agent", ActionScope.SHELL_EXEC.value, "deploy.sh") is True

    def test_high_risk_denied_by_handler(self):
        ps = PermissionSystem()
        ps.grant("agent", ActionScope.DB_DELETE.value)
        ps.set_confirmation_handler(lambda a, s, x: False)
        assert ps.check("agent", ActionScope.DB_DELETE.value, "drop table") is False


class TestAuditTrail:
    def test_allowed_action_recorded(self):
        ps = PermissionSystem()
        ps.grant("agent", ActionScope.FILE_READ.value)
        ps.check("agent", ActionScope.FILE_READ.value, "open")
        log = ps.audit_log(actor="agent")
        assert len(log) == 1
        assert log[0].decision == "allowed"

    def test_denied_action_recorded(self):
        ps = PermissionSystem()
        ps.check("agent", ActionScope.FILE_READ.value, "open")
        log = ps.audit_log(decision="denied")
        assert len(log) >= 1

    def test_audit_log_filter_by_scope(self):
        ps = PermissionSystem()
        ps.grant("agent", ActionScope.FILE_READ.value, ActionScope.DB_READ.value)
        ps.check("agent", ActionScope.FILE_READ.value, "r")
        ps.check("agent", ActionScope.DB_READ.value, "r")
        log = ps.audit_log(scope=ActionScope.DB_READ.value)
        assert all(r.scope == ActionScope.DB_READ.value for r in log)

    def test_audit_limit_respected(self):
        ps = PermissionSystem()
        ps.grant("agent", ActionScope.FILE_READ.value)
        for _ in range(20):
            ps.check("agent", ActionScope.FILE_READ.value, "r")
        log = ps.audit_log(limit=5)
        assert len(log) == 5


class TestRollback:
    def test_rollback_calls_function(self):
        ps = PermissionSystem()
        rolled_back = []
        ps.register_rollback("op-1", lambda: rolled_back.append(True))
        assert ps.rollback("op-1") is True
        assert rolled_back == [True]

    def test_rollback_consumes_registration(self):
        ps = PermissionSystem()
        ps.register_rollback("op-2", lambda: None)
        ps.rollback("op-2")
        assert ps.rollback("op-2") is False

    def test_rollback_unknown_returns_false(self):
        ps = PermissionSystem()
        assert ps.rollback("ghost") is False
