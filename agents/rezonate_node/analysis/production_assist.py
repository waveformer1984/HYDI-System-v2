"""Local production suggestions matching the rezonate-ai-assist edge function.

Provides the same six request types and identical response shapes as the
edge function, computed locally without a network call.  The key invariant:
same inputs always produce the same outputs.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass
class AssistResult:
    """Wraps the request type and the structured suggestion dict."""

    request_type: str
    result: dict


class ProductionAssist:
    """Local inference for AI production suggestions.

    Each method mirrors the corresponding handler in ``rezonate-ai-assist``
    (Deno).  Where a ``context`` value is recognised (e.g. ``bpm``), it seeds
    the response; otherwise the default stub value is used.  This keeps the
    output deterministic while still being useful when context is available.
    """

    # Must stay in sync with VALID_REQUEST_TYPES in the edge function.
    SUPPORTED_TYPES: list[str] = [
        "tighten_timing",
        "remove_noise",
        "find_key",
        "suggest_bassline",
        "detect_clipping",
        "generate_drum_layer",
    ]

    def suggest(
        self,
        request_type: str,
        context: dict | None = None,
    ) -> AssistResult:
        """Return a bounded, deterministic suggestion for *request_type*.

        Raises ``ValueError`` for unknown request types so callers can surface
        the mismatch rather than silently returning garbage.
        """
        ctx: dict = context or {}

        if request_type not in self.SUPPORTED_TYPES:
            raise ValueError(
                f"request_type must be one of: {', '.join(self.SUPPORTED_TYPES)}; "
                f"received: {request_type!r}"
            )

        handler_name = f"_handle_{request_type}"
        handler = getattr(self, handler_name)
        result = handler(ctx)

        return AssistResult(request_type=request_type, result=result)

    # ------------------------------------------------------------------
    # Per-type handlers — shapes match the edge function exactly
    # ------------------------------------------------------------------

    @staticmethod
    def _handle_find_key(context: dict) -> dict:
        return {
            "key": "C major",
            "confidence": 0.85,
            "alternatives": ["A minor"],
        }

    @staticmethod
    def _handle_detect_clipping(context: dict) -> dict:
        return {
            "detected": False,
            "peak_db": -2.1,
            "recommendation": "headroom is adequate",
        }

    @staticmethod
    def _handle_tighten_timing(context: dict) -> dict:
        # Use caller-supplied BPM if present; stub values otherwise.
        bpm = context.get("bpm")
        groove_template = "straight"
        offset_ms = 12
        quantize = "1/16"

        if bpm is not None:
            # At lower tempos, a slightly larger timing offset is acceptable.
            try:
                bpm_val = float(bpm)
                if bpm_val < 80:
                    offset_ms = 20
                    quantize = "1/8"
                elif bpm_val > 160:
                    offset_ms = 6
                    quantize = "1/32"
            except (TypeError, ValueError):
                pass

        return {
            "offset_ms": offset_ms,
            "suggested_quantize": quantize,
            "groove_template": groove_template,
        }

    @staticmethod
    def _handle_suggest_bassline(context: dict) -> dict:
        return {
            "root_note": "C2",
            "pattern": [1, 0, 0, 1, 0, 1, 0, 0],
            "style": "four-on-floor",
        }

    @staticmethod
    def _handle_remove_noise(context: dict) -> dict:
        return {
            "threshold_db": -45,
            "estimated_snr_db": 18,
            "method": "spectral_gate",
        }

    @staticmethod
    def _handle_generate_drum_layer(context: dict) -> dict:
        return {
            "pattern": [1, 0, 0, 1, 0, 0, 1, 0],
            "instrument": "kick",
            "bpm_aligned": True,
        }
