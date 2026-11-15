"""NCM backends: mock (CI/dev) and optional official checkpoint loader."""

from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Any


@dataclass
class GenerateResult:
    ok: bool
    text: str
    metadata: dict[str, Any]
    error: str | None = None


class MockNcmBackend:
    """Deterministic stub — does not call PyTorch. Used when checkpoints are absent."""

    mode = "mock"

    def health(self) -> dict[str, Any]:
        return {
            "ok": True,
            "mode": self.mode,
            "checkpoint": None,
            "note": "Set HYDI_NCM_CHECKPOINT_DIR to hazyresearch/ncm-checkpoints task folder for live NCM",
        }

    def generate(self, prompt: str, task: str, max_tokens: int) -> GenerateResult:
        outline = (
            f"[NCM mock — task={task}] Coarse plan (level 0): address the request in "
            f"{min(max_tokens, 128)} tokens.\n"
            f"[level 1 refine] {prompt[:240]}{'…' if len(prompt) > 240 else ''}"
        )
        return GenerateResult(
            ok=True,
            text=outline,
            metadata={
                "backend": "mock",
                "levels_simulated": 2,
                "parallel_positions": True,
                "official_repo": "https://github.com/HazyResearch/ncm",
            },
        )


class OfficialNcmBackend:
    """
    Loads tokenizer + generator from HYDI_NCM_CHECKPOINT_DIR (per official config.yaml).
    Imports HazyResearch/ncm when HYDI_NCM_SRC is on PYTHONPATH.
    """

    mode = "official"

    def __init__(self, checkpoint_dir: str) -> None:
        self.checkpoint_dir = checkpoint_dir
        self._ready = False
        self._load_error: str | None = None
        try:
            import torch  # noqa: F401

            self._ready = os.path.isdir(checkpoint_dir)
            if not self._ready:
                self._load_error = "checkpoint_dir missing"
        except ImportError as e:
            self._load_error = f"torch not installed: {e}"

    def health(self) -> dict[str, Any]:
        return {
            "ok": self._ready,
            "mode": self.mode,
            "checkpoint": self.checkpoint_dir if self._ready else None,
            "error": self._load_error,
        }

    def generate(self, prompt: str, task: str, max_tokens: int) -> GenerateResult:
        if not self._ready:
            return GenerateResult(
                ok=False,
                text="",
                metadata={"backend": "official", "task": task},
                error=self._load_error or "ncm_not_ready",
            )
        # Full generation wiring belongs in a follow-up once checkpoints are pinned on Frank.
        # evaluate.py remains the authoritative entry for quality gates until then.
        return GenerateResult(
            ok=False,
            text="",
            metadata={
                "backend": "official",
                "task": task,
                "checkpoint_dir": self.checkpoint_dir,
            },
            error="official_generate_not_wired_use_evaluate_py",
        )


def create_backend() -> MockNcmBackend | OfficialNcmBackend:
    ckpt = os.environ.get("HYDI_NCM_CHECKPOINT_DIR", "").strip()
    if ckpt:
        return OfficialNcmBackend(ckpt)
    if os.environ.get("HYDI_NCM_MOCK", "1") not in ("0", "false", "False"):
        return MockNcmBackend()
    return OfficialNcmBackend(ckpt or "/nonexistent")