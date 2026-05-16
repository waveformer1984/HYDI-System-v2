"""PROTOFORGE UNIFIED DATA SCHEMA

Shared structures for Event, Task, Memory, and Module data.
Every subsystem that participates in the ecosystem speaks these types.
"""
from __future__ import annotations

import json
import time
import uuid
from dataclasses import dataclass, asdict, field
from enum import Enum
from typing import Any, Dict, List, Optional


# ── Event ─────────────────────────────────────────────────────────────────────

class EventType(str, Enum):
    TASK_QUEUED      = "task.queued"
    TASK_STARTED     = "task.started"
    TASK_SUCCEEDED   = "task.succeeded"
    TASK_FAILED      = "task.failed"
    TASK_CANCELLED   = "task.cancelled"
    TASK_RETRY       = "task.retry"
    MODULE_REGISTERED   = "module.registered"
    MODULE_DEREGISTERED = "module.deregistered"
    MODULE_HEALTH       = "module.health"
    MEMORY_WRITTEN   = "memory.written"
    MEMORY_RECALLED  = "memory.recalled"
    MEMORY_PRUNED    = "memory.pruned"
    SYSTEM_ALERT     = "system.alert"
    SYSTEM_SHUTDOWN  = "system.shutdown"
    PERMISSION_GRANTED = "permission.granted"
    PERMISSION_DENIED  = "permission.denied"


@dataclass
class Event:
    event_id:       str              = field(default_factory=lambda: str(uuid.uuid4()))
    event_type:     str              = EventType.SYSTEM_ALERT.value
    source:         str              = ""
    timestamp:      float            = field(default_factory=time.time)
    payload:        Dict[str, Any]   = field(default_factory=dict)
    correlation_id: Optional[str]    = None
    version:        str              = "1.0"

    def to_json(self) -> str:
        return json.dumps(asdict(self))

    @classmethod
    def from_json(cls, raw: str) -> "Event":
        return cls(**json.loads(raw))

    @classmethod
    def create(
        cls,
        event_type: EventType,
        source: str,
        payload: Optional[Dict[str, Any]] = None,
        correlation_id: Optional[str] = None,
    ) -> "Event":
        return cls(
            event_type=event_type.value,
            source=source,
            payload=payload or {},
            correlation_id=correlation_id,
        )


# ── Task ──────────────────────────────────────────────────────────────────────

class TaskStatus(str, Enum):
    PENDING   = "pending"
    QUEUED    = "queued"
    RUNNING   = "running"
    SUCCEEDED = "succeeded"
    FAILED    = "failed"
    CANCELLED = "cancelled"
    RETRYING  = "retrying"


class TaskPriority(int, Enum):
    CRITICAL   = 0
    HIGH       = 1
    NORMAL     = 2
    LOW        = 3
    BACKGROUND = 4


@dataclass
class TaskResult:
    success:          bool
    output:           Any            = None
    error:            Optional[str]  = None
    duration_seconds: float          = 0.0
    attempts:         int            = 1


@dataclass
class Task:
    task_id:          str              = field(default_factory=lambda: str(uuid.uuid4()))
    task_type:        str              = ""
    payload:          Dict[str, Any]   = field(default_factory=dict)
    status:           str              = TaskStatus.PENDING.value
    priority:         int              = TaskPriority.NORMAL.value
    created_at:       float            = field(default_factory=time.time)
    queued_at:        Optional[float]  = None
    started_at:       Optional[float]  = None
    finished_at:      Optional[float]  = None
    max_retries:      int              = 3
    attempts:         int              = 0
    timeout_seconds:  float            = 300.0
    depends_on:       List[str]        = field(default_factory=list)
    assigned_module:  Optional[str]    = None
    result:           Optional[TaskResult] = None
    tags:             List[str]        = field(default_factory=list)
    correlation_id:   Optional[str]    = None

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)

    def to_json(self) -> str:
        return json.dumps(self.to_dict())

    @classmethod
    def from_json(cls, raw: str) -> "Task":
        data = json.loads(raw)
        result_data = data.pop("result", None)
        task = cls(**data)
        if result_data:
            task.result = TaskResult(**result_data)
        return task

    @classmethod
    def create(
        cls,
        task_type: str,
        payload: Optional[Dict[str, Any]] = None,
        priority: TaskPriority = TaskPriority.NORMAL,
        max_retries: int = 3,
        timeout_seconds: float = 300.0,
        depends_on: Optional[List[str]] = None,
        tags: Optional[List[str]] = None,
    ) -> "Task":
        return cls(
            task_type=task_type,
            payload=payload or {},
            priority=priority.value,
            max_retries=max_retries,
            timeout_seconds=timeout_seconds,
            depends_on=depends_on or [],
            tags=tags or [],
        )


# ── Memory ────────────────────────────────────────────────────────────────────

class MemoryType(str, Enum):
    EPISODIC   = "episodic"    # things that happened
    PROCEDURAL = "procedural"  # how to do things
    SEMANTIC   = "semantic"    # facts about the world
    ACTIVE     = "active"      # current working context
    ARCHIVE    = "archive"     # compressed long-term storage


class MemoryImportance(int, Enum):
    CRITICAL  = 5
    HIGH      = 4
    NORMAL    = 3
    LOW       = 2
    EPHEMERAL = 1


@dataclass
class MemoryEntry:
    memory_id:    str              = field(default_factory=lambda: str(uuid.uuid4()))
    memory_type:  str              = MemoryType.EPISODIC.value
    content:      str              = ""
    summary:      Optional[str]    = None
    tags:         List[str]        = field(default_factory=list)
    source:       str              = ""
    importance:   int              = MemoryImportance.NORMAL.value
    created_at:   float            = field(default_factory=time.time)
    accessed_at:  float            = field(default_factory=time.time)
    access_count: int              = 0
    expires_at:   Optional[float]  = None
    embedding_id: Optional[str]    = None
    metadata:     Dict[str, Any]   = field(default_factory=dict)

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)

    def to_json(self) -> str:
        return json.dumps(self.to_dict())

    @classmethod
    def from_json(cls, raw: str) -> "MemoryEntry":
        return cls(**json.loads(raw))

    @classmethod
    def create(
        cls,
        content: str,
        memory_type: MemoryType,
        source: str,
        importance: MemoryImportance = MemoryImportance.NORMAL,
        tags: Optional[List[str]] = None,
        expires_in_seconds: Optional[float] = None,
    ) -> "MemoryEntry":
        return cls(
            content=content,
            memory_type=memory_type.value,
            source=source,
            importance=importance.value,
            tags=tags or [],
            expires_at=time.time() + expires_in_seconds if expires_in_seconds else None,
        )


# ── Module ────────────────────────────────────────────────────────────────────

class ModuleStatus(str, Enum):
    STARTING    = "starting"
    ONLINE      = "online"
    OFFLINE     = "offline"
    DEGRADED    = "degraded"
    MAINTENANCE = "maintenance"
    STOPPING    = "stopping"


@dataclass
class ModuleCapability:
    name:                  str              = ""
    version:               str              = "1.0"
    description:           str              = ""
    input_schema:          Dict[str, Any]   = field(default_factory=dict)
    output_schema:         Dict[str, Any]   = field(default_factory=dict)
    permissions_required:  List[str]        = field(default_factory=list)


@dataclass
class ModuleRecord:
    module_id:                  str                      = field(default_factory=lambda: str(uuid.uuid4()))
    module_type:                str                      = ""
    display_name:               str                      = ""
    version:                    str                      = "1.0.0"
    status:                     str                      = ModuleStatus.STARTING.value
    host:                       str                      = ""
    endpoint:                   Optional[str]            = None
    capabilities:               List[ModuleCapability]   = field(default_factory=list)
    accepted_task_types:        List[str]                = field(default_factory=list)
    registered_at:              float                    = field(default_factory=time.time)
    last_heartbeat:             float                    = field(default_factory=time.time)
    heartbeat_interval_seconds: float                    = 30.0
    health_score:               float                    = 1.0
    metadata:                   Dict[str, Any]           = field(default_factory=dict)

    def is_healthy(self) -> bool:
        grace = self.heartbeat_interval_seconds * 3
        return (
            self.status == ModuleStatus.ONLINE.value
            and (time.time() - self.last_heartbeat) < grace
        )

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)

    def to_json(self) -> str:
        return json.dumps(self.to_dict())

    @classmethod
    def from_json(cls, raw: str) -> "ModuleRecord":
        data = json.loads(raw)
        caps_data = data.pop("capabilities", [])
        module = cls(**data)
        module.capabilities = [ModuleCapability(**c) for c in caps_data]
        return module
