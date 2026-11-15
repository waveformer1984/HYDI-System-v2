"""FastAPI sidecar for Stanford NCM — isolated from Ollama and heidi-core."""

from __future__ import annotations

import os
from typing import Any

from fastapi import FastAPI
from pydantic import BaseModel, Field

from .backend import create_backend

app = FastAPI(title="HYDI NCM Inference", version="0.1.0-experimental")
_backend = create_backend()


class GenerateRequest(BaseModel):
    prompt: str = Field(..., min_length=1, max_length=32_000)
    task: str = Field(default="planning", max_length=64)
    max_tokens: int = Field(default=512, ge=16, le=4096)


@app.get("/health")
def health() -> dict[str, Any]:
    h = _backend.health()
    return {"ok": bool(h.get("ok", True)), **h}


@app.post("/v1/generate")
def generate(body: GenerateRequest) -> dict[str, Any]:
    result = _backend.generate(body.prompt, body.task, body.max_tokens)
    return {
        "ok": result.ok,
        "text": result.text,
        "error": result.error,
        "metadata": result.metadata,
    }


def run() -> None:
    import uvicorn

    port = int(os.environ.get("HYDI_NCM_PORT", "8791"))
    host = os.environ.get("HYDI_NCM_BIND", "127.0.0.1")
    uvicorn.run(app, host=host, port=port, log_level="info")


if __name__ == "__main__":
    run()