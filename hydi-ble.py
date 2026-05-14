#!/usr/bin/env python3
"""
hydi-ble.py — Hydi BLE Chat Portal
Runs a BLE GATT server so any Web Bluetooth browser can chat with Hydi.

  Service UUID : 4fafc201-1fb5-459e-8fcc-c5c9c331914b
  MSG_IN  (Write)  : beb5483e-36e1-4688-b7f5-ea07361b26a8  — client → Hydi
  MSG_OUT (Notify) : beb5483e-36e1-4688-b7f5-ea07361b26a9  — Hydi  → client
  STATUS  (Read)   : beb5483e-36e1-4688-b7f5-ea07361b26aa  — live system JSON

Setup (Termux):
    pkg install python bluez bluez-libs
    pip install bless
    python hydi-ble.py

If BlueZ isn't available in plain Termux, run inside proot-distro Ubuntu:
    pkg install proot-distro
    proot-distro install ubuntu
    proot-distro login ubuntu -- bash -c "
        apt update && apt install -y python3 python3-pip bluetooth
        pip3 install bless
        python3 ~/hydi/hydi-ble.py
    "

Client: open in any Chrome / Edge (Web Bluetooth required, HTTPS or localhost):
    https://waveformer1984.github.io/hydi-system-v2/hydi-ble-client.html
"""

import asyncio
import json
import logging
import os
import sys
import time
from urllib.request import urlopen, Request as UReq

# ── UUIDs ─────────────────────────────────────────────────────────────────────
DEVICE_NAME  = "Hydi"
HYDI_SVC     = "4fafc201-1fb5-459e-8fcc-c5c9c331914b"
MSG_IN_CHR   = "beb5483e-36e1-4688-b7f5-ea07361b26a8"
MSG_OUT_CHR  = "beb5483e-36e1-4688-b7f5-ea07361b26a9"
STATUS_CHR   = "beb5483e-36e1-4688-b7f5-ea07361b26aa"

MAX_CHUNK    = 500   # bytes per BLE notification (safe below any MTU)

# ── Dependency check ──────────────────────────────────────────────────────────
try:
    from bless import (
        BlessServer,
        BlessGATTCharacteristic,
        GATTCharacteristicProperties as Props,
        GATTAttributePermissions as Perms,
    )
except ImportError:
    print("\n  bless not found.  Install it:\n")
    print("    pip install bless\n")
    print("  On Termux you may also need:")
    print("    pkg install bluez bluez-libs\n")
    sys.exit(1)

# ── ProtoForge state ──────────────────────────────────────────────────────────
PF = {
    "autonomy_level": 2,
    "agents": {
        "architect": "running", "engineer":  "running",
        "finance":   "running", "legal":     "idle",
        "marketing": "idle",    "ops":       "running",
        "analytics": "running", "cascade":   "running",
        "heidi":     "running", "ursula":    "idle",
        "security":  "running", "realtime":  "running",
        "outreach":  "idle",    "memory":    "idle",
        "executive": "running",
    },
    "capital": 248500,
    "actions": 0,
    "start_time": time.time(),
}

AUTONOMY_NAMES = {
    0: "OBSERVE", 1: "ASSIST", 2: "EXECUTE WITH APPROVAL",
    3: "CONDITIONAL AUTONOMY", 4: "FULL AUTONOMY",
}

# ── AI backends ───────────────────────────────────────────────────────────────
GROQ_KEY     = os.environ.get("GROQ_API_KEY", "")
GROQ_MODEL   = None
OLLAMA_URL   = os.environ.get("OLLAMA_URL", "http://localhost:11434")
OLLAMA_MODEL = None


def _probe_groq():
    global GROQ_MODEL
    if not GROQ_KEY or GROQ_KEY.startswith("gsk_PASTE"):
        return
    for model in ["llama-3.3-70b-versatile", "llama-3.1-8b-instant"]:
        try:
            data = json.dumps({
                "model": model,
                "messages": [{"role": "user", "content": "hi"}],
                "max_tokens": 5,
            }).encode()
            req = UReq(
                "https://api.groq.com/openai/v1/chat/completions",
                data=data,
                headers={
                    "Content-Type": "application/json",
                    "Authorization": f"Bearer {GROQ_KEY}",
                },
            )
            with urlopen(req, timeout=8):
                pass
            GROQ_MODEL = model
            return
        except Exception:
            continue


def _probe_ollama():
    global OLLAMA_MODEL
    try:
        with urlopen(f"{OLLAMA_URL}/api/tags", timeout=3) as r:
            data = json.loads(r.read())
        models = [m["name"] for m in data.get("models", [])]
        if models:
            OLLAMA_MODEL = models[0]
    except Exception:
        pass


def _groq_chat(messages):
    if not GROQ_MODEL:
        return None
    try:
        data = json.dumps({
            "model": GROQ_MODEL,
            "messages": messages,
            "max_tokens": 512,
            "temperature": 0.7,
        }).encode()
        req = UReq(
            "https://api.groq.com/openai/v1/chat/completions",
            data=data,
            headers={
                "Content-Type": "application/json",
                "Authorization": f"Bearer {GROQ_KEY}",
            },
        )
        with urlopen(req, timeout=30) as r:
            return json.loads(r.read())["choices"][0]["message"]["content"].strip()
    except Exception:
        return None


def _ollama_chat(messages):
    if not OLLAMA_MODEL:
        return None
    try:
        data = json.dumps({
            "model": OLLAMA_MODEL,
            "messages": messages,
            "stream": False,
            "options": {"temperature": 0.7, "num_predict": 512},
        }).encode()
        req = UReq(
            f"{OLLAMA_URL}/api/chat",
            data=data,
            headers={"Content-Type": "application/json"},
        )
        with urlopen(req, timeout=60) as r:
            return json.loads(r.read()).get("message", {}).get("content", "").strip()
    except Exception:
        return None


_SCRIPTED = [
    "ProtoForge: OPERATIONAL. All 15 agents standing by.",
    "Autonomy {al}: {an}. Capital deployed: ${cap:,}.",
    "CASCADE mesh synchronized. Ready for commands.",
    "Systems nominal. What do you want to build today?",
    "Trust score 82%. {act} actions completed this session.",
]


def _system_prompt():
    running = sum(1 for s in PF["agents"].values() if s == "running")
    return (
        "You are Hydi, the AI brain of ProtoForge — a 15-agent autonomous system.\n"
        "Be concise (3-8 lines), calm, futuristic. User is on mobile via BLE.\n\n"
        f"State: autonomy={PF['autonomy_level']} ({AUTONOMY_NAMES[PF['autonomy_level']]}), "
        f"agents={running}/15 running, capital=${PF['capital']:,}, actions={PF['actions']}"
    )


# ── Conversation history ──────────────────────────────────────────────────────
_history = []
MAX_HIST  = 20


def _sync_reply(user_msg: str) -> str:
    """Synchronous AI call: Groq → Ollama → scripted."""
    _history.append({"role": "user", "content": user_msg})
    messages = [{"role": "system", "content": _system_prompt()}] + _history[-MAX_HIST:]

    reply = _groq_chat(messages) or _ollama_chat(messages)
    if not reply:
        tmpl = _SCRIPTED[len(_history) % len(_SCRIPTED)]
        reply = tmpl.format(
            al=PF["autonomy_level"],
            an=AUTONOMY_NAMES[PF["autonomy_level"]],
            cap=PF["capital"],
            act=PF["actions"],
        )

    _history.append({"role": "assistant", "content": reply})
    if len(_history) > MAX_HIST * 2:
        del _history[:-MAX_HIST]
    return reply


# ── BLE server ────────────────────────────────────────────────────────────────
_server = None


def _status_bytes() -> bytes:
    running = sum(1 for s in PF["agents"].values() if s == "running")
    return json.dumps({
        "a": PF["autonomy_level"],
        "c": PF["capital"],
        "r": running,
        "x": PF["actions"],
    }).encode()[:512]


def _on_read(char: BlessGATTCharacteristic, **_) -> bytearray:
    if str(char.uuid).lower() == STATUS_CHR.lower():
        return bytearray(_status_bytes())
    return bytearray()


def _on_write(char: BlessGATTCharacteristic, value: bytearray, **_):
    if str(char.uuid).lower() != MSG_IN_CHR.lower():
        return
    msg = bytes(value).decode("utf-8", errors="replace").strip()
    if msg:
        print(f"  ← {msg}")
        asyncio.ensure_future(_process_msg(msg))


async def _process_msg(msg: str):
    reply = await asyncio.to_thread(_sync_reply, msg)
    src = ("groq" if GROQ_MODEL else ("ollama" if OLLAMA_MODEL else "scripted"))
    print(f"  → [{src}] {reply[:80]}{'…' if len(reply) > 80 else ''}")
    await _send_chunks(reply)


async def _send_chunks(text: str):
    """Split reply into MAX_CHUNK-byte BLE notifications."""
    if _server is None:
        return
    encoded = text.encode("utf-8")
    chunks = [encoded[i:i + MAX_CHUNK] for i in range(0, len(encoded), MAX_CHUNK)]
    for i, chunk in enumerate(chunks):
        prefix = b"\x01" if i < len(chunks) - 1 else b"\x00"  # 0x00 = final
        char = _server.get_characteristic(MSG_OUT_CHR)
        char.value = bytearray(prefix + chunk)
        _server.update_value(HYDI_SVC, MSG_OUT_CHR)
        await asyncio.sleep(0.05)


BANNER = """
  ██╗  ██╗██╗   ██╗██████╗ ██╗
  ██║  ██║╚██╗ ██╔╝██╔══██╗██║
  ███████║ ╚████╔╝ ██║  ██║██║
  ██╔══██║  ╚██╔╝  ██║  ██║██║
  ██║  ██║   ██║   ██████╔╝██║
  ╚═╝  ╚═╝   ╚═╝   ╚═════╝ ╚═╝
  BLE Chat Portal
"""


async def main():
    global _server

    print(BANNER)
    print("  Probing AI backends...")
    _probe_groq()
    _probe_ollama()
    ai_src = (
        f"groq/{GROQ_MODEL}" if GROQ_MODEL
        else (f"ollama/{OLLAMA_MODEL}" if OLLAMA_MODEL else "scripted")
    )
    print(f"  AI: {ai_src}\n")

    loop = asyncio.get_running_loop()
    _server = BlessServer(name=DEVICE_NAME, loop=loop)
    _server.read_request_func  = _on_read
    _server.write_request_func = _on_write

    gatt = {
        HYDI_SVC: {
            MSG_IN_CHR: {
                "Properties": Props.write | Props.write_without_response,
                "Permissions": Perms.writeable,
                "Value": None,
            },
            MSG_OUT_CHR: {
                "Properties": Props.read | Props.notify,
                "Permissions": Perms.readable,
                "Value": None,
            },
            STATUS_CHR: {
                "Properties": Props.read,
                "Permissions": Perms.readable,
                "Value": None,
            },
        }
    }

    await _server.add_gatt(gatt)
    await _server.start()

    print(f"  Advertising as '{DEVICE_NAME}'")
    print(f"  Service: {HYDI_SVC}")
    print()
    print(f"  Open the client in Chrome (Web Bluetooth required):")
    print(f"  https://waveformer1984.github.io/hydi-system-v2/hydi-ble-client.html")
    print()
    print("  Ctrl+C to stop.\n")

    try:
        while True:
            await asyncio.sleep(1)
    except (KeyboardInterrupt, asyncio.CancelledError):
        pass
    finally:
        await _server.stop()
        print("\nBLE server stopped.")


if __name__ == "__main__":
    logging.basicConfig(level=logging.WARNING)
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        pass
