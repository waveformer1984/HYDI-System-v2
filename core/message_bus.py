"""PROTOFORGE MESSAGE BUS

Redis-Streams-backed pub/sub with in-process fallback.
Supports topic subscriptions, wildcard listeners, and reliable delivery.
"""
from __future__ import annotations

import logging
import threading
import time
from typing import Any, Callable, Dict, List, Optional

from .schemas import Event, EventType

logger = logging.getLogger("ProtoForge.MessageBus")

Handler = Callable[[Event], None]


class MessageBus:
    """
    Event bus backed by a Redis Stream.

    - Topic subscriptions: ``bus.subscribe(EventType.TASK_QUEUED, handler)``
    - Wildcard: ``bus.subscribe("*", handler)`` receives every event
    - Falls back to in-process threading when Redis is unavailable
    - Thread-safe for all operations
    """

    STREAM_KEY = "protoforge:events"

    def __init__(self, redis_url: Optional[str] = None) -> None:
        self._handlers: Dict[str, List[Handler]] = {}
        self._lock = threading.RLock()
        self._shutdown = threading.Event()
        self._redis = self._connect(redis_url)
        self._listener: Optional[threading.Thread] = None
        if self._redis:
            self._start_listener()

    # ------------------------------------------------------------------
    # Connection
    # ------------------------------------------------------------------

    def _connect(self, url: Optional[str]):
        if not url:
            return None
        try:
            import redis
            client = redis.from_url(url, socket_connect_timeout=2, decode_responses=True)
            client.ping()
            logger.info("MessageBus connected to Redis: %s", url)
            return client
        except Exception as exc:
            logger.warning("Redis unavailable (%s) — using in-process bus", exc)
            return None

    # ------------------------------------------------------------------
    # Subscribe / unsubscribe
    # ------------------------------------------------------------------

    def subscribe(self, topic: str, handler: Handler) -> None:
        """Subscribe to a topic string or EventType value. Use '*' for all."""
        if isinstance(topic, EventType):
            topic = topic.value
        with self._lock:
            self._handlers.setdefault(topic, []).append(handler)
        logger.debug("Subscribed: %s", topic)

    def unsubscribe(self, topic: str, handler: Handler) -> None:
        if isinstance(topic, EventType):
            topic = topic.value
        with self._lock:
            try:
                self._handlers.get(topic, []).remove(handler)
            except ValueError:
                pass

    # ------------------------------------------------------------------
    # Publish
    # ------------------------------------------------------------------

    def publish(self, event: Event) -> None:
        if self._redis:
            self._redis_publish(event)
        else:
            self._dispatch(event)

    def emit(
        self,
        event_type: EventType,
        source: str,
        payload: Optional[Dict[str, Any]] = None,
        correlation_id: Optional[str] = None,
    ) -> Event:
        """Convenience: create and publish in one call."""
        event = Event.create(event_type, source=source, payload=payload, correlation_id=correlation_id)
        self.publish(event)
        return event

    def _redis_publish(self, event: Event) -> None:
        try:
            self._redis.xadd(self.STREAM_KEY, {"data": event.to_json()}, maxlen=10_000)
        except Exception as exc:
            logger.warning("Redis publish failed (%s) — dispatching locally", exc)
            self._dispatch(event)

    def _dispatch(self, event: Event) -> None:
        with self._lock:
            handlers: List[Handler] = []
            for topic in (event.event_type, "*"):
                handlers.extend(self._handlers.get(topic, []))
        for handler in handlers:
            try:
                handler(event)
            except Exception as exc:
                logger.exception("Handler error for %s: %s", event.event_type, exc)

    # ------------------------------------------------------------------
    # Redis stream listener
    # ------------------------------------------------------------------

    def _start_listener(self) -> None:
        self._listener = threading.Thread(
            target=self._listener_loop,
            name="MessageBus-Listener",
            daemon=True,
        )
        self._listener.start()
        logger.info("Redis stream listener started")

    def _listener_loop(self) -> None:
        last_id = "$"
        while not self._shutdown.is_set():
            try:
                results = self._redis.xread(
                    {self.STREAM_KEY: last_id},
                    count=100,
                    block=1000,
                )
                if not results:
                    continue
                for _, messages in results:
                    for msg_id, fields in messages:
                        last_id = msg_id
                        try:
                            self._dispatch(Event.from_json(fields["data"]))
                        except Exception as exc:
                            logger.warning("Event deserialize error: %s", exc)
            except Exception as exc:
                if not self._shutdown.is_set():
                    logger.error("Listener error: %s — reconnecting in 2s", exc)
                    time.sleep(2)

    def stop(self) -> None:
        self._shutdown.set()
        if self._listener:
            self._listener.join(timeout=5.0)
        logger.info("MessageBus stopped")
