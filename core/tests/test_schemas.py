"""Tests for core.schemas"""
from __future__ import annotations

import json
import time

import pytest

from core.schemas import (
    Event, EventType,
    MemoryEntry, MemoryImportance, MemoryType,
    ModuleCapability, ModuleRecord, ModuleStatus,
    Task, TaskPriority, TaskResult, TaskStatus,
)


class TestEvent:
    def test_create_sets_event_type(self):
        e = Event.create(EventType.TASK_QUEUED, source="test")
        assert e.event_type == EventType.TASK_QUEUED.value

    def test_create_sets_source(self):
        e = Event.create(EventType.TASK_QUEUED, source="scheduler")
        assert e.source == "scheduler"

    def test_to_json_roundtrip(self):
        e = Event.create(EventType.MEMORY_WRITTEN, source="mem", payload={"k": "v"})
        e2 = Event.from_json(e.to_json())
        assert e2.event_id == e.event_id
        assert e2.payload == {"k": "v"}

    def test_correlation_id_propagated(self):
        e = Event.create(EventType.TASK_STARTED, source="engine", correlation_id="cid-1")
        assert e.correlation_id == "cid-1"

    def test_timestamp_is_recent(self):
        before = time.time()
        e = Event.create(EventType.SYSTEM_ALERT, source="x")
        assert e.timestamp >= before


class TestTask:
    def test_create_sets_task_type(self):
        t = Task.create("mix_analysis")
        assert t.task_type == "mix_analysis"

    def test_default_priority_is_normal(self):
        t = Task.create("render")
        assert t.priority == TaskPriority.NORMAL.value

    def test_depends_on_defaults_empty(self):
        t = Task.create("export")
        assert t.depends_on == []

    def test_json_roundtrip_without_result(self):
        t = Task.create("stem_analysis", payload={"url": "s3://bucket/file"})
        t2 = Task.from_json(t.to_json())
        assert t2.task_id == t.task_id
        assert t2.payload == {"url": "s3://bucket/file"}
        assert t2.result is None

    def test_json_roundtrip_with_result(self):
        t = Task.create("render")
        t.result = TaskResult(success=True, output={"file": "out.wav"}, duration_seconds=1.5)
        t2 = Task.from_json(t.to_json())
        assert t2.result is not None
        assert t2.result.success is True
        assert t2.result.output == {"file": "out.wav"}

    def test_high_priority_value_lower_than_normal(self):
        assert TaskPriority.HIGH.value < TaskPriority.NORMAL.value

    def test_critical_priority_lowest_int(self):
        assert TaskPriority.CRITICAL.value == 0


class TestMemoryEntry:
    def test_create_sets_type_and_content(self):
        m = MemoryEntry.create("the sky is blue", MemoryType.SEMANTIC, source="env")
        assert m.memory_type == MemoryType.SEMANTIC.value
        assert m.content == "the sky is blue"

    def test_expires_at_set_when_ttl_given(self):
        before = time.time()
        m = MemoryEntry.create("temp", MemoryType.ACTIVE, source="ctx", expires_in_seconds=60)
        assert m.expires_at is not None
        assert m.expires_at >= before + 60

    def test_no_expiry_when_ttl_not_given(self):
        m = MemoryEntry.create("perm", MemoryType.SEMANTIC, source="kb")
        assert m.expires_at is None

    def test_json_roundtrip(self):
        m = MemoryEntry.create("hello", MemoryType.EPISODIC, source="chat", tags=["a", "b"])
        m2 = MemoryEntry.from_json(m.to_json())
        assert m2.memory_id == m.memory_id
        assert m2.tags == ["a", "b"]

    def test_importance_defaults_normal(self):
        m = MemoryEntry.create("x", MemoryType.PROCEDURAL, source="sys")
        assert m.importance == MemoryImportance.NORMAL.value


class TestModuleRecord:
    def test_is_healthy_when_online_and_recent_heartbeat(self):
        m = ModuleRecord(module_type="rezonate", status=ModuleStatus.ONLINE.value)
        m.last_heartbeat = time.time()
        assert m.is_healthy() is True

    def test_not_healthy_when_offline(self):
        m = ModuleRecord(module_type="rezonate", status=ModuleStatus.OFFLINE.value)
        assert m.is_healthy() is False

    def test_not_healthy_when_heartbeat_stale(self):
        m = ModuleRecord(module_type="rezonate", status=ModuleStatus.ONLINE.value)
        m.last_heartbeat = time.time() - 1000
        assert m.is_healthy() is False

    def test_json_roundtrip(self):
        m = ModuleRecord(
            module_type="rezonate",
            display_name="Rezonate Node",
            capabilities=[ModuleCapability(name="mix")],
        )
        m2 = ModuleRecord.from_json(m.to_json())
        assert m2.display_name == "Rezonate Node"
        assert len(m2.capabilities) == 1
        assert m2.capabilities[0].name == "mix"
