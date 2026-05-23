"""USB HID fallback for pad controllers not exposed via MIDI."""

from __future__ import annotations

import logging
import threading
from typing import Callable

# Re-use the shared event type rather than duplicating its definition here.
from .midi_controller import PadTriggerEvent

logger = logging.getLogger("HYDI.RezonateNode.HIDController")

# hidapi (pip install hid) is optional — import guarded so the module loads
# safely on systems without it installed.
try:
    import hid  # type: ignore[import-untyped]
    HAS_HID = True
except ImportError:
    HAS_HID = False


class HIDController:
    """USB HID pad controller fallback for devices not exposed via MIDI.

    Raw HID report parsing is device-specific.  The byte offsets and bitmasks
    used to detect pad triggers MUST be configured per device via
    ``pad_byte_index`` and ``pad_bitmasks`` at construction time or through
    subclassing.  The defaults here reflect a common 8-pad layout where byte 0
    of the report carries a pad bitmask, but this will vary across hardware.

    Byte layout assumption (override as needed):
        report[pad_byte_index] & pad_bitmasks[n]  != 0  => pad n is pressed
    """

    def __init__(self, vendor_id: int, product_id: int) -> None:
        self._vendor_id = vendor_id
        self._product_id = product_id
        self._device: object | None = None
        self._callbacks: list[Callable[[PadTriggerEvent], None]] = []
        self._stop_event: threading.Event = threading.Event()
        self._running: bool = False

        # Byte index in the HID report that carries pad state.
        # Device-specific: consult device HID descriptor or datasheet.
        self.pad_byte_index: int = 0

        # One bitmask per pad (up to 8).  A non-zero AND result means the pad
        # is active.  These values are illustrative and must be adjusted for
        # the target hardware.
        self.pad_bitmasks: list[int] = [
            0x01, 0x02, 0x04, 0x08,
            0x10, 0x20, 0x40, 0x80,
        ]

        # Previous report snapshot used to detect rising edges (press, not hold).
        self._prev_pad_state: int = 0

    # ------------------------------------------------------------------
    # Connection lifecycle
    # ------------------------------------------------------------------

    def connect(self) -> bool:
        """Open the HID device.

        Returns ``False`` without raising if hidapi is absent or the device
        cannot be opened — callers should treat this as a degraded-but-safe
        state.
        """
        if not HAS_HID:
            logger.warning(
                "hid (hidapi) not installed; HIDController running as stub"
            )
            return False

        try:
            device = hid.device()  # type: ignore[attr-defined]
            device.open(self._vendor_id, self._product_id)
            device.set_nonblocking(True)
            self._device = device
            logger.info(
                "HIDController connected: VID=0x%04x PID=0x%04x", self._vendor_id, self._product_id
            )
            return True
        except Exception as exc:
            logger.warning("HIDController could not open device: %s", exc)
            return False

    def disconnect(self) -> None:
        """Close the HID device and release resources."""
        self.stop()
        if self._device is not None:
            try:
                self._device.close()  # type: ignore[union-attr]
            except Exception as exc:
                logger.debug("Error closing HID device: %s", exc)
            self._device = None
            logger.info("HIDController disconnected")

    # ------------------------------------------------------------------
    # Callback registration
    # ------------------------------------------------------------------

    def on_pad_trigger(self, cb: Callable[[PadTriggerEvent], None]) -> None:
        """Register a callback invoked whenever a pad press is detected."""
        self._callbacks.append(cb)

    # ------------------------------------------------------------------
    # Run loop
    # ------------------------------------------------------------------

    def run(self) -> None:
        """Blocking loop that reads raw HID reports and dispatches pad events.

        Call this in a dedicated thread.  Exits when ``stop()`` is called.

        Pad detection logic: a pad is considered triggered on the rising edge
        of its bitmask — i.e. the bit transitions from 0 to 1 between
        consecutive reports.  Velocity is fixed at 100 for HID devices since
        raw HID reports typically do not encode velocity.
        """
        if self._device is None:
            logger.warning("HIDController.run() called without an active connection")
            return

        self._stop_event.clear()
        self._running = True
        logger.debug("HIDController polling loop started")

        while not self._stop_event.is_set():
            try:
                # read() returns a list of ints (bytes) or an empty list.
                report: list[int] = self._device.read(64)  # type: ignore[union-attr]
            except Exception as exc:
                logger.warning("HID read error: %s", exc)
                break

            if report and len(report) > self.pad_byte_index:
                current_state = report[self.pad_byte_index]
                # Rising edges: bits that are 1 now but were 0 before.
                new_presses = current_state & ~self._prev_pad_state
                if new_presses:
                    self._dispatch_presses(new_presses)
                self._prev_pad_state = current_state
            else:
                self._stop_event.wait(timeout=0.005)

        self._running = False
        logger.debug("HIDController polling loop stopped")

    def stop(self) -> None:
        """Signal the run loop to exit."""
        self._stop_event.set()

    # ------------------------------------------------------------------
    # Properties
    # ------------------------------------------------------------------

    @property
    def is_connected(self) -> bool:
        return self._device is not None

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _dispatch_presses(self, new_presses: int) -> None:
        """Convert a bitmask of newly-pressed pads into PadTriggerEvents."""
        for pad_index, mask in enumerate(self.pad_bitmasks):
            if new_presses & mask:
                event = PadTriggerEvent(
                    pad_index=pad_index,
                    velocity=100,   # HID reports do not carry velocity
                    midi_note=pad_index,
                )
                self._dispatch(event)

    def _dispatch(self, event: PadTriggerEvent) -> None:
        """Call all registered callbacks; log and continue past any that raise."""
        for cb in self._callbacks:
            try:
                cb(event)
            except Exception as exc:
                logger.warning("Pad trigger callback raised: %s", exc)
