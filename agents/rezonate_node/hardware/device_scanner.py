"""Discovers connected audio/MIDI/HID pad controllers via lsusb or equivalent."""

from __future__ import annotations

import logging
import subprocess
import re
from dataclasses import dataclass, field

logger = logging.getLogger("HYDI.RezonateNode.DeviceScanner")


@dataclass
class DeviceInfo:
    """Metadata for a single discovered hardware device."""

    name: str
    vendor_id: int | None
    product_id: int | None
    # Literal values: 'midi' | 'hid' | 'audio'
    device_type: str
    path: str | None


class DeviceScanner:
    """Discovers connected audio/MIDI/HID pad controllers.

    Runs ``lsusb`` on Linux and parses its output.  Falls back to an empty
    list on any failure so callers never need to guard against exceptions.
    """

    # Maps (vendor_id, product_id) to a human-readable device name.
    KNOWN_PAD_CONTROLLERS: dict[tuple[int, int], str] = {
        (0x09E8, 0x0037): "Akai MPD218",
        (0x1C75, 0x0206): "Arturia Beatstep",
        (0x17CC, 0x1200): "Native Instruments Maschine Mikro",
    }

    def scan(self) -> list[DeviceInfo]:
        """Return all USB devices visible to the system.

        Parses ``lsusb`` output.  Each line has the form:
        ``Bus NNN Device NNN: ID vvvv:pppp <description>``
        Unknown vendor/product IDs are still included with name set to the
        raw lsusb description string.
        """
        try:
            result = subprocess.run(
                ["lsusb"],
                capture_output=True,
                text=True,
                timeout=5,
            )
        except (FileNotFoundError, subprocess.TimeoutExpired) as exc:
            logger.warning("lsusb not available or timed out: %s", exc)
            return []

        if result.returncode != 0:
            logger.warning("lsusb returned non-zero exit code: %d", result.returncode)
            return []

        devices: list[DeviceInfo] = []
        # Pattern: "Bus 001 Device 003: ID 09e8:0037 Akai Professional M.I. Corp. ..."
        pattern = re.compile(
            r"Bus\s+\d+\s+Device\s+\d+:\s+ID\s+([0-9a-fA-F]{4}):([0-9a-fA-F]{4})\s*(.*)"
        )

        for line in result.stdout.splitlines():
            match = pattern.match(line.strip())
            if not match:
                continue

            vid = int(match.group(1), 16)
            pid = int(match.group(2), 16)
            raw_name = match.group(3).strip() or f"{vid:04x}:{pid:04x}"

            # Look up in known list; fall back to raw description.
            key = (vid, pid)
            name = self.KNOWN_PAD_CONTROLLERS.get(key, raw_name)
            device_type = "hid"  # default; callers can inspect further

            devices.append(
                DeviceInfo(
                    name=name,
                    vendor_id=vid,
                    product_id=pid,
                    device_type=device_type,
                    path=None,
                )
            )

        logger.debug("DeviceScanner found %d USB device(s)", len(devices))
        return devices

    def find_pad_controllers(self) -> list[DeviceInfo]:
        """Return only devices matched against KNOWN_PAD_CONTROLLERS."""
        all_devices = self.scan()
        pads: list[DeviceInfo] = []

        for device in all_devices:
            if device.vendor_id is None or device.product_id is None:
                continue
            key = (device.vendor_id, device.product_id)
            if key in self.KNOWN_PAD_CONTROLLERS:
                # Mark these explicitly as hid; MIDI routing is the
                # caller's responsibility once a pad controller is identified.
                pads.append(device)

        logger.info(
            "DeviceScanner found %d known pad controller(s)", len(pads)
        )
        return pads
