"""Local audio fingerprinting — pure stdlib, no network required."""

from __future__ import annotations

import base64
import hashlib
import struct
from dataclasses import dataclass


@dataclass
class FingerprintResult:
    """Fingerprint data for a single audio buffer."""

    hash: str              # Full SHA-256 hex digest of raw audio bytes
    chroma_vector: list[float]   # 12 evenly-sampled bytes / 255.0
    spectral_hash: str     # First 16 hex chars of the SHA-256 reversed
    duration_seconds: float


class AudioFingerprinter:
    """Computes deterministic audio fingerprints from raw bytes.

    All operations are pure stdlib (hashlib, struct, base64).  The same input
    always produces the same output, which allows the edge function and local
    agent to cross-verify fingerprints without a network round-trip.
    """

    # Assumed encoding when the byte count alone is used to estimate duration.
    _FALLBACK_SAMPLE_RATE: int = 44100
    _FALLBACK_BYTES_PER_SAMPLE: int = 2  # 16-bit mono

    def fingerprint_bytes(self, audio_bytes: bytes) -> FingerprintResult:
        """Fingerprint a raw audio buffer."""
        sha = hashlib.sha256(audio_bytes).hexdigest()

        chroma_vector = self._compute_chroma(audio_bytes)
        spectral_hash = self._compute_spectral_hash(sha)
        duration = self._estimate_duration(audio_bytes)

        return FingerprintResult(
            hash=sha,
            chroma_vector=chroma_vector,
            spectral_hash=spectral_hash,
            duration_seconds=duration,
        )

    def fingerprint_wav(self, filepath: str) -> FingerprintResult:
        """Fingerprint a WAV file, parsing the RIFF header for true duration."""
        with open(filepath, "rb") as fh:
            raw = fh.read()

        # Try to extract sample rate and data chunk size from the WAV header.
        duration = self._parse_wav_duration(raw)

        sha = hashlib.sha256(raw).hexdigest()
        chroma_vector = self._compute_chroma(raw)
        spectral_hash = self._compute_spectral_hash(sha)

        return FingerprintResult(
            hash=sha,
            chroma_vector=chroma_vector,
            spectral_hash=spectral_hash,
            duration_seconds=duration,
        )

    def fingerprint_blob_base64(self, base64_str: str) -> FingerprintResult:
        """Fingerprint audio delivered as a base-64 encoded string."""
        audio_bytes = base64.b64decode(base64_str)
        return self.fingerprint_bytes(audio_bytes)

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    @staticmethod
    def _compute_chroma(data: bytes) -> list[float]:
        """Sample 12 evenly-spaced bytes and normalise to [0.0, 1.0]."""
        length = len(data)
        if length == 0:
            return [0.0] * 12
        indices = [int(i * length / 12) for i in range(12)]
        return [data[i] / 255.0 for i in indices]

    @staticmethod
    def _compute_spectral_hash(sha_hex: str) -> str:
        """Return the first 16 hex chars of the SHA-256 string reversed.

        Reversing the digest before truncating gives a hash that varies at the
        front rather than the back, which distributes better across a flat
        namespace when many files share a common prefix.
        """
        return sha_hex[::-1][:16]

    @classmethod
    def _estimate_duration(cls, data: bytes) -> float:
        """Estimate duration from byte count, assuming 44100 Hz / 16-bit / mono."""
        if len(data) == 0:
            return 0.0
        bytes_per_second = cls._FALLBACK_SAMPLE_RATE * cls._FALLBACK_BYTES_PER_SAMPLE
        return len(data) / bytes_per_second

    @classmethod
    def _parse_wav_duration(cls, data: bytes) -> float:
        """Parse a RIFF/WAV header to extract the true playback duration.

        WAV layout (all little-endian):
          Offset  Size  Field
             0     4    'RIFF'
             4     4    file size - 8
             8     4    'WAVE'
            12     4    'fmt '
            16     4    fmt chunk size (16 for PCM)
            20     2    audio format (1 = PCM)
            22     2    num channels
            24     4    sample rate
            28     4    byte rate
            32     2    block align
            34     2    bits per sample
        Then one or more chunks, each: 4-byte ID + 4-byte size + data.

        Falls back to byte-count estimation if the header cannot be parsed.
        """
        try:
            if len(data) < 44 or data[:4] != b"RIFF" or data[8:12] != b"WAVE":
                return cls._estimate_duration(data)

            # Parse fmt chunk (assume it starts at offset 12).
            if data[12:16] != b"fmt ":
                return cls._estimate_duration(data)

            fmt_size = struct.unpack_from("<I", data, 16)[0]
            sample_rate = struct.unpack_from("<I", data, 24)[0]

            if sample_rate == 0:
                return cls._estimate_duration(data)

            # Walk chunks after the fmt chunk to find 'data'.
            offset = 12 + 8 + fmt_size  # 'fmt ' id(4) + size(4) + payload
            data_chunk_size: int | None = None

            while offset + 8 <= len(data):
                chunk_id = data[offset: offset + 4]
                chunk_size = struct.unpack_from("<I", data, offset + 4)[0]
                if chunk_id == b"data":
                    data_chunk_size = chunk_size
                    break
                offset += 8 + chunk_size

            if data_chunk_size is None:
                return cls._estimate_duration(data)

            # byte_rate = sample_rate * num_channels * bits_per_sample / 8
            byte_rate = struct.unpack_from("<I", data, 28)[0]
            if byte_rate == 0:
                return cls._estimate_duration(data)

            return data_chunk_size / byte_rate

        except struct.error:
            return cls._estimate_duration(data)
