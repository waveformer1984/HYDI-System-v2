"""Reads MIDI messages from a connected pad controller and dispatches pad trigger events."""

from __future__ import annotations

import logging
import threading
from dataclasses import dataclass
from typing import Callable

logger = logging.getLogger("HYDI.RezonateNode.MidiController")

# python-rtmidi is an optional dependency — import guarded so the module loads
# safely on systems without it installed.
try:
    import rtmidi  # type: ignore[import-untyped]
    HAS_RTMIDI = True
except ImportError:
    HAS_RTMIDI = False


@dataclass
class PadTriggerEvent:
    """Represents a single pad hit from a MIDI pad controller."""

    pad_index: int   # 0-7, clamped from the raw MIDI note
    velocity: int    # 0-127
    midi_note: int   # raw MIDI note value


class MidiController:
    """Connects to a MIDI pad device and fires callbacks on pad hits.

    MIDI note-to-pad mapping:
        ``pad_index = max(0, min(7, note - start_note))``

    If python-rtmidi is not installed, ``connect()`` returns ``False`` and the
    controller operates as a no-op stub — no exceptions are raised.
    """

    DEFAULT_PAD_NOTE_START: int = 36  # covers Akai MPD218, Arturia Beatstep

    def __init__(self, device_name: str | None = None) -> None:
        self._requested_device: str | None = device_name
        self._connected_device: str | None = None
        self._pad_note_start: int = self.DEFAULT_PAD_NOTE_START
        self._pad_count: int = 8
        self._callbacks: list[Callable[[PadTriggerEvent], None]] = []
        self._running: bool = False
        self._stop_event: threading.Event = threading.Event()
        self._midi_in: object | None = None

    # ------------------------------------------------------------------
    # Configuration
    # ------------------------------------------------------------------

    def set_pad_note_range(self, start_note: int, count: int = 8) -> None:
        """Set the MIDI note that maps to pad index 0 and how many pads to cover."""
        self._pad_note_start = start_note
        self._pad_count = count

    def on_pad_trigger(self, cb: Callable[[PadTriggerEvent], None]) -> None:
        """Register a callback invoked whenever a pad is struck."""
        self._callbacks.append(cb)

    # ------------------------------------------------------------------
    # Connection lifecycle
    # ------------------------------------------------------------------

    def connect(self) -> bool:
        """Open the first available MIDI input port (or the named one).

        Returns ``False`` without raising if rtmidi is absent or no device
        is found — callers should treat this as a degraded-but-safe state.
        """
        if not HAS_RTMIDI:
            logger.warning(
                "python-rtmidi not installed; MidiController running as stub"
            )
            return False

        midi_in = rtmidi.MidiIn()  # type: ignore[attr-defined]
        ports: list[str] = midi_in.get_ports()

        if not ports:
            logger.warning("No MIDI input ports found")
            midi_in.delete()
            return False

        # Select port: prefer the requested device name, else use port 0.
        port_index = 0
        if self._requested_device:
            for idx, port_name in enumerate(ports):
                if self._requested_device.lower() in port_name.lower():
                    port_index = idx
                    break

        chosen_name = ports[port_index]
        midi_in.open_port(port_index)
        midi_in.ignore_types(sysex=True, timing=True, active_sense=True)

        self._midi_in = midi_in
        self._connected_device = chosen_name
        logger.info("MidiController connected: %s", chosen_name)
        return True

    def disconnect(self) -> None:
        """Close the MIDI port and release resources."""
        self.stop()
        if self._midi_in is not None:
            try:
                self._midi_in.close_port()  # type: ignore[union-attr]
                self._midi_in.delete()      # type: ignore[union-attr]
            except Exception as exc:
                logger.debug("Error closing MIDI port: %s", exc)
            self._midi_in = None
            self._connected_device = None
            logger.info("MidiController disconnected")

    # ------------------------------------------------------------------
    # Run loop
    # ------------------------------------------------------------------

    def run(self) -> None:
        """Blocking loop that polls for MIDI messages.

        Call this in a dedicated thread.  Exits when ``stop()`` is called.
        """
        if self._midi_in is None:
            logger.warning("MidiController.run() called without an active connection")
            return

        self._stop_event.clear()
        self._running = True
        logger.debug("MidiController polling loop started")

        while not self._stop_event.is_set():
            # get_message returns (message, delta_time) or None
            msg_data = self._midi_in.get_message()  # type: ignore[union-attr]
            if msg_data is None:
                self._stop_event.wait(timeout=0.005)
                continue

            message, _delta = msg_data
            self._handle_message(message)

        self._running = False
        logger.debug("MidiController polling loop stopped")

    def stop(self) -> None:
        """Signal the run loop to exit."""
        self._stop_event.set()

    # ------------------------------------------------------------------
    # Properties
    # ------------------------------------------------------------------

    @property
    def is_connected(self) -> bool:
        return self._midi_in is not None

    @property
    def device_name(self) -> str | None:
        return self._connected_device

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _handle_message(self, message: list[int]) -> None:
        """Translate a raw MIDI message into a PadTriggerEvent if applicable."""
        if len(message) < 3:
            return

        status, note, velocity = message[0], message[1], message[2]

        # 0x90-0x9F = Note On on channel 1-16; 0x80-0x8F = Note Off.
        # Treat Note On with velocity > 0 as a pad hit.
        is_note_on = (status & 0xF0) == 0x90 and velocity > 0
        if not is_note_on:
            return

        pad_index = max(0, min(self._pad_count - 1, note - self._pad_note_start))
        event = PadTriggerEvent(pad_index=pad_index, velocity=velocity, midi_note=note)
        self._dispatch(event)

    def _dispatch(self, event: PadTriggerEvent) -> None:
        """Call all registered callbacks; log and continue past any that raise."""
        for cb in self._callbacks:
            try:
                cb(event)
            except Exception as exc:
                logger.warning("Pad trigger callback raised: %s", exc)
