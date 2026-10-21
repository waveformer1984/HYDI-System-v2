#!/usr/bin/env python3
"""
hydi.py — ProtoForge command interface for Termux / mobile.
Pure Python 3 stdlib. No external packages required.

AI priority order:
  1. Groq API  (fastest, free, phone-friendly) — set GROQ_API_KEY
  2. Ollama    (local, no internet needed)      — set OLLAMA_URL or run locally
  3. llama.cpp (the hydi runit service)         — HYDI_LLAMA_URL, default :8080
  4. Scripted  (always works, zero deps)

Usage:
    python hydi.py              # HTTP server (mobile PWA) on :3006
    python hydi.py cli          # interactive terminal chat
    python hydi.py server 3007  # server on custom port
    python hydi.py status       # single command, then exit
"""

import sys, os, re, time, json, threading, subprocess, socket
from http.server import HTTPServer, BaseHTTPRequestHandler
from urllib.parse import parse_qs, urlparse
from urllib.request import urlopen, Request
from urllib.error import URLError

# ── Thin-client config (termux/setup-thin-client.sh) ─────
# KEY=VALUE lines from ~/.hydi/thin-client.env fill in env vars that are not
# already set, so an explicit `export OLLAMA_URL=...` still wins. Holds only
# non-secret settings (OLLAMA_URL, HYDI_UPSTREAM).
def _load_thin_client_env(path=os.path.expanduser("~/.hydi/thin-client.env")):
    try:
        with open(path, encoding="utf-8") as fh:
            for raw in fh:
                line = raw.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                key, _, value = line.partition("=")
                key = key.strip()
                if key.startswith("export "):
                    key = key[len("export "):].strip()
                value = value.strip().strip('"').strip("'")
                if key and key not in os.environ:
                    os.environ[key] = value
    except OSError:
        pass

_load_thin_client_env()

# ── ProtoForge state ─────────────────────────────────────
REVENUE_STREAMS = [
    "galactic_bytes", "detailer_bot", "lipi_v2",
    "protogrance_aromatics", "rezonate", "waveformer_studio",
]

PF = {
    "autonomy_level": 3,  # CONDITIONAL AUTONOMY — revenue directive
    "primary_directive": "REVENUE_GENERATION",
    "agents": {
        "architect": "running", "engineer":  "running",
        "finance":   "running", "legal":     "running",
        "marketing": "running", "ops":       "running",
        "analytics": "running", "cascade":   "running",
        "heidi":     "running", "ursula":    "running",
        "security":  "running", "realtime":  "running",
        "outreach":  "running", "memory":    "running",
        "executive": "running",
    },
    "approvals": [],
    "actions": 0,
    "success_rate": 0.94,
    "trust_score": 0.82,
    "capital": 248500,
    "revenue_streams": {s: {"status": "active", "mrr": 0} for s in REVENUE_STREAMS},
    "events": [],
    "start_time": time.time(),
}

AUTONOMY_NAMES = {
    0: "OBSERVE",
    1: "ASSIST",
    2: "EXECUTE WITH APPROVAL",
    3: "CONDITIONAL AUTONOMY",
    4: "FULL AUTONOMY",
}

# ── Groq (cloud, free tier, phone-friendly) ──────────────
GROQ_API_KEY   = os.environ.get("GROQ_API_KEY", "")
GROQ_API_URL   = "https://api.groq.com/openai/v1/chat/completions"
# Best free Groq models in preference order
GROQ_MODELS    = [
    "llama-3.3-70b-versatile",   # best quality
    "llama-3.1-8b-instant",      # fastest
    "mixtral-8x7b-32768",        # good balance
    "llama3-70b-8192",
    "llama3-8b-8192",
]
GROQ_MODEL     = None  # confirmed at startup

def detect_groq():
    """Verify the API key works and pick the best available Groq model."""
    global GROQ_MODEL
    if not GROQ_API_KEY:
        return None
    # Try each model preference until one responds
    for model in GROQ_MODELS:
        try:
            payload = json.dumps({
                "model": model,
                "messages": [{"role": "user", "content": "hi"}],
                "max_tokens": 5,
            }).encode()
            req = Request(
                GROQ_API_URL,
                data=payload,
                headers={
                    "Content-Type": "application/json",
                    "Authorization": f"Bearer {GROQ_API_KEY}",
                },
            )
            with urlopen(req, timeout=8) as r:
                json.loads(r.read())  # confirm valid JSON back
            GROQ_MODEL = model
            return model
        except Exception:
            continue
    return None

def groq_chat(messages):
    """Call Groq OpenAI-compatible API. Returns reply string or None."""
    if not GROQ_MODEL or not GROQ_API_KEY:
        return None
    payload = json.dumps({
        "model": GROQ_MODEL,
        "messages": messages,
        "max_tokens": 512,
        "temperature": 0.7,
    }).encode()
    req = Request(
        GROQ_API_URL,
        data=payload,
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {GROQ_API_KEY}",
        },
    )
    try:
        with urlopen(req, timeout=30) as r:
            result = json.loads(r.read())
        return result["choices"][0]["message"]["content"].strip()
    except Exception:
        return None

# ── Ollama (local, no internet needed) ───────────────────
OLLAMA_URL   = os.environ.get("OLLAMA_URL", "http://localhost:11434")
OLLAMA_MODEL = None
PREFERRED_MODELS = [
    "llama3.2", "llama3.1", "llama3", "llama2",
    "mistral", "mixtral", "phi3", "phi4",
    "gemma3", "gemma2", "gemma",
    "qwen2.5", "qwen2", "deepseek-r1",
]

# When Ollama is the HYDI PC (thin client over the tailnet), prefer the model
# that host is tuned for; small local models stay the fallback order.
REMOTE_PREFERRED_MODELS = ["qwen2.5:3b-instruct", "qwen2.5"]

# ── Frank host resolution (multi-link thin client) ───────
# FRANK_HOSTS is a comma list like "192.168.86.178,100.118.182.126" so the
# phone can follow Frank from home Wi-Fi to Tailscale on cellular. Each host
# is probed for Ollama (:11434/api/tags) and the board (:3000, /api/ping or
# GET /api/board) with a 2s timeout; the first winner is cached 60s and
# re-probed on failure. FRANK_IP alone acts as a one-entry list. When neither
# is set, OLLAMA_URL and HYDI_BOARD_UPSTREAM keep working exactly as before.
FRANK_CACHE_TTL = 60.0      # positive cache
FRANK_MISS_TTL = 10.0       # how long "no host" is cached before re-probing
FRANK_PROBE_TIMEOUT = 2
_FRANK = {"host": None, "ts": 0.0, "logged": "unset"}

def frank_candidates():
    """Ordered Frank hostnames/IPs from FRANK_HOSTS, falling back to FRANK_IP."""
    raw = os.environ.get("FRANK_HOSTS", "") or os.environ.get("FRANK_IP", "")
    hosts = []
    for part in raw.split(","):
        part = part.strip()
        if not part:
            continue
        host = urlparse("http://" + part).hostname
        if host and host not in hosts:
            hosts.append(host)
    return hosts

def _probe(url):
    try:
        with urlopen(url, timeout=FRANK_PROBE_TIMEOUT) as r:
            return r.status < 500
    except Exception:
        return False

def _frank_probe(host):
    """Reachability snapshot for one candidate."""
    ollama = _probe(f"http://{host}:11434/api/tags")
    board = _probe(f"http://{host}:3000/api/ping") or \
        _probe(f"http://{host}:3000/api/board?channel=general")
    return {"host": host, "ollama": ollama, "board": board}

def frank_link_label(host):
    """UI label for the active link."""
    if not host:
        return "Offline copy"
    parts = host.split(".")
    try:
        octets = [int(p) for p in parts]
    except ValueError:
        octets = []
    if len(octets) == 4:
        if octets[0] == 100 and 64 <= octets[1] <= 127:
            return "Frank via Tailscale"
        if octets[0] == 10 or (octets[0] == 192 and octets[1] == 168) or \
                (octets[0] == 172 and 16 <= octets[1] <= 31):
            return "Frank via Wi-Fi"
    if host.endswith(".ts.net"):
        return "Frank via Tailscale"
    return f"Frank via {host}"

def frank_resolve(force=False):
    """Pick the first reachable Frank host; cache the result and log changes."""
    if not frank_candidates():
        return None
    now = time.time()
    cached, age = _FRANK["host"], now - _FRANK["ts"]
    if not force and age < (FRANK_CACHE_TTL if cached else FRANK_MISS_TTL):
        return cached
    winner, partial = None, None
    for host in frank_candidates():
        probe = _frank_probe(host)
        if probe["ollama"] and probe["board"]:
            winner = host
            break
        if (probe["ollama"] or probe["board"]) and partial is None:
            partial = host
    _FRANK["host"], _FRANK["ts"] = winner or partial, now
    if _FRANK["host"] != _FRANK["logged"]:
        _FRANK["logged"] = _FRANK["host"]
        if _FRANK["host"]:
            note = f"hydi: Frank host -> {_FRANK['host']} ({frank_link_label(_FRANK['host'])})"
        else:
            note = "hydi: no Frank host reachable — offline copy"
        print(note)
        log_event(note, "ok" if _FRANK["host"] else "warn")
    if _FRANK["host"]:
        os.environ["HYDI_BOARD_UPSTREAM"] = f"http://{_FRANK['host']}:3000"
    return _FRANK["host"]

def _frank_note_failure():
    """Drop the cached host so the next call re-probes."""
    _FRANK["ts"] = 0.0

def frank_link():
    return frank_link_label(frank_resolve())

def ollama_base():
    host = frank_resolve()
    if host:
        return f"http://{host}:11434"
    return OLLAMA_URL

def ollama_is_remote(url=None):
    host = (urlparse(url or ollama_base()).hostname or "").lower()
    return host not in ("localhost", "127.0.0.1", "::1", "")

def detect_ollama():
    """Return the best available Ollama model name, or None."""
    global OLLAMA_MODEL
    remote = ollama_is_remote()
    try:
        with urlopen(f"{ollama_base()}/api/tags", timeout=8 if remote else 3) as r:
            data = json.loads(r.read())
        models = [m["name"] for m in data.get("models", [])]
        if not models:
            return None
        order = (REMOTE_PREFERRED_MODELS + PREFERRED_MODELS) if remote else PREFERRED_MODELS
        for pref in order:
            for m in models:
                if pref in m.lower():
                    OLLAMA_MODEL = m
                    return m
        OLLAMA_MODEL = models[0]
        return OLLAMA_MODEL
    except Exception:
        _frank_note_failure()
        return None

def ollama_chat(messages):
    """Call Ollama /api/chat. Returns reply string or None."""
    if not OLLAMA_MODEL:
        return None
    payload = json.dumps({
        "model": OLLAMA_MODEL,
        "messages": messages,
        "stream": False,
        "options": {"temperature": 0.7, "num_predict": 512},
    }).encode()
    req = Request(
        f"{ollama_base()}/api/chat",
        data=payload,
        headers={"Content-Type": "application/json"},
    )
    try:
        with urlopen(req, timeout=60) as r:
            result = json.loads(r.read())
        return result.get("message", {}).get("content", "").strip()
    except Exception:
        _frank_note_failure()
        return None

# ── llama.cpp server (termux service "hydi", port 8080) ──
# The dashboard does not start this process. The runit service does.
# Chat uses it only when Groq and Ollama are both unavailable.
LLAMA_URL   = os.environ.get("HYDI_LLAMA_URL", "http://127.0.0.1:8080").rstrip("/")
LLAMA_MODEL = None

def detect_llama():
    """Return the model id from llama-server /v1/models, or None."""
    global LLAMA_MODEL
    LLAMA_MODEL = None
    try:
        with urlopen(f"{LLAMA_URL}/v1/models", timeout=3) as r:
            data = json.loads(r.read())
        models = data.get("data") or []
        if not models:
            return None
        name = models[0].get("id") or "llama.cpp"
        LLAMA_MODEL = name
        return name
    except Exception:
        return None

def llama_chat(messages):
    """Call llama-server's OpenAI-compatible chat endpoint."""
    if not LLAMA_MODEL:
        return None
    payload = json.dumps({
        "model": LLAMA_MODEL,
        "messages": messages,
        "temperature": 0.7,
        "max_tokens": 512,
    }).encode()
    req = Request(
        f"{LLAMA_URL}/v1/chat/completions",
        data=payload,
        headers={"Content-Type": "application/json"},
    )
    try:
        with urlopen(req, timeout=90) as r:
            result = json.loads(r.read())
        content = result["choices"][0]["message"]["content"]
        return content.strip() if isinstance(content, str) else None
    except Exception:
        return None

def refresh_backends():
    """Groq, else Ollama, else the local llama.cpp server."""
    global OLLAMA_MODEL, LLAMA_MODEL
    detect_groq()
    if GROQ_MODEL:
        OLLAMA_MODEL = None
        LLAMA_MODEL = None
        return
    OLLAMA_MODEL = None
    detect_ollama()
    if OLLAMA_MODEL:
        LLAMA_MODEL = None
        return
    LLAMA_MODEL = None
    detect_llama()

def ai_ready():
    return bool(GROQ_MODEL or OLLAMA_MODEL or LLAMA_MODEL)

# ── Real fleet status (dashboard) ────────────────────────
# The dashboard's agent grid used to show a fabricated 15-agent mesh that was
# always "running". fleet_status() reports what is actually true right now:
# which link to Frank is live, which AI backend answered, whether the board is
# upstream or a local copy, and what the phone's runit services are doing.
def _sv_status(name):
    try:
        r = subprocess.run(
            ["sv", "status", name],
            capture_output=True, text=True, timeout=5,
        )
        line = (r.stdout + r.stderr).strip()
        if not line:
            return None
        if line.startswith("run:"):
            status = "running"
        elif line.startswith("down:"):
            status = "idle"
        else:
            status = "error"
        return {"status": status, "detail": line[:80]}
    except Exception:
        return None

def fleet_status():
    """Real subsystem cards for the dashboard. Everything is probed."""
    items = []

    hosts = frank_candidates()
    frank = frank_resolve() if hosts else None
    items.append({
        "id": "frank", "name": "Frank", "icon": "🖥️",
        "role": "HYDI PC — Ollama + shared board",
        "status": "running" if frank else ("error" if hosts else "idle"),
        "detail": frank_link_label(frank) if frank else
                  ("all hosts unreachable" if hosts else "not configured"),
        "fleet": True,
    })

    if OLLAMA_MODEL:
        where = "remote" if ollama_is_remote() else "local"
        items.append({
            "id": "ollama", "name": "Ollama", "icon": "🦙",
            "role": "Chat AI backend",
            "status": "running",
            "detail": f"{OLLAMA_MODEL} ({where})",
            "fleet": True,
        })
    else:
        items.append({
            "id": "ollama", "name": "Ollama", "icon": "🦙",
            "role": "Chat AI backend",
            "status": "error" if hosts else "idle",
            "detail": "no model — host down?" if hosts else "not detected",
            "fleet": True,
        })

    items.append({
        "id": "groq", "name": "Groq", "icon": "☁️",
        "role": "Cloud AI backend",
        "status": "running" if GROQ_MODEL else ("error" if GROQ_API_KEY else "idle"),
        "detail": GROQ_MODEL or ("key set but no model answered" if GROQ_API_KEY else "no API key"),
        "fleet": True,
    })

    items.append({
        "id": "llama", "name": "llama.cpp", "icon": "🔥",
        "role": "Local fallback model (:8080)",
        "status": "running" if LLAMA_MODEL else "idle",
        "detail": LLAMA_MODEL or "service down or not started",
        "fleet": True,
    })

    try:
        board_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "lib", "forge-board")
        if board_dir not in sys.path:
            sys.path.insert(0, board_dir)
        import store
        upstream = store._upstream()
        pending = store.pending_outbox_count()
        if upstream:
            live = store._upstream_request("GET", {"channel": "general"}, None, "")
            ok = isinstance(live, dict) and live.get("ok")
            detail = ("upstream reachable" if ok else "offline copy")
            if pending:
                detail += f" · {pending} pending"
            items.append({
                "id": "board", "name": "Forge Board", "icon": "📋",
                "role": "Shared agent room",
                "status": "running" if ok else "error",
                "detail": detail, "fleet": True,
            })
        else:
            items.append({
                "id": "board", "name": "Forge Board", "icon": "📋",
                "role": "Shared agent room",
                "status": "idle", "detail": "local copy only (no upstream)",
                "fleet": True,
            })
    except Exception:
        items.append({
            "id": "board", "name": "Forge Board", "icon": "📋",
            "role": "Shared agent room",
            "status": "error", "detail": "board store unavailable",
            "fleet": True,
        })

    for svc in ("hydi", "hydi-daemon"):
        sv = _sv_status(svc)
        if sv:
            items.append({
                "id": svc, "name": svc, "icon": "📟",
                "role": "Termux runit service",
                "status": sv["status"], "detail": sv["detail"], "fleet": True,
            })

    items.append({
        "id": "hydi-py", "name": "hydi.py", "icon": "📱",
        "role": "This dashboard server (:3006)",
        "status": "running", "detail": f"up {uptime_str()}",
        "fleet": True,
    })
    return items

def models_payload():
    active = GROQ_MODEL or OLLAMA_MODEL or LLAMA_MODEL
    return {
        "groq_model": GROQ_MODEL,
        "ollama_model": OLLAMA_MODEL,
        "llama_model": LLAMA_MODEL,
        "llama_url": LLAMA_URL,
        "active_model": active,
        "active_label": active_ai_label(),
        "groq_online": GROQ_MODEL is not None,
        "ollama_online": OLLAMA_MODEL is not None,
        "llama_online": LLAMA_MODEL is not None,
        "frank_host": frank_resolve(),
        "frank_link": frank_link(),
        "mode": "ai" if ai_ready() else "scripted",
    }

# ── Shared chat history ───────────────────────────────────
CHAT_HISTORY = {}   # session_id -> [{role, content}]
MAX_HISTORY  = 20

def active_ai_label():
    """Human-readable label for the active AI backend."""
    if GROQ_MODEL:
        return f"groq/{GROQ_MODEL.split('-')[0]}"
    if OLLAMA_MODEL:
        return f"ollama/{OLLAMA_MODEL.split(':')[0]}"
    if LLAMA_MODEL:
        return f"llama/{LLAMA_MODEL.split('/')[-1]}"
    return "scripted"

def ai_chat(messages):
    """Call the best available AI backend. Groq → Ollama → llama.cpp → None."""
    reply = groq_chat(messages)
    if reply:
        return reply
    reply = ollama_chat(messages)
    if reply:
        return reply
    return llama_chat(messages)

AUTONOMY_LABEL = "(display only — no executor connected)"
NO_ACTION_NOTE = "Note: no action was taken — Hydi can't execute from this chat."
_ACTION_CLAIM = re.compile(
    r"("
    r"\bi['’]ve\s+(?:done|identified|scaled|updated|optimized|executed|queued|started)\b"
    r"|has been updated"
    r"|\bproof\b"
    r")",
    re.IGNORECASE,
)

def build_system_prompt():
    fleet = fleet_status()
    fleet_summary = ", ".join(f"{i['name']}={i['status']}" for i in fleet) or "none"
    active_streams = ", ".join(REVENUE_STREAMS)
    total_mrr = sum(s["mrr"] for s in PF["revenue_streams"].values())
    return (
        "You are Hydi on a phone. You can talk, and you can read the live fleet and stats below. "
        "You have no tools and you cannot execute.\n"
        "Never say you did, scaled, reviewed, updated, queued, or started anything "
        "unless a command result in this turn proves it.\n"
        "When asked to act, say you cannot do that from this chat. "
        "The real path is a REQUEST on Forge Board #ops for @Heidi, or an approval on Frank.\n"
        "A few short lines. The numbers below are readings, not work you did.\n\n"
        f"Live fleet: {fleet_summary}\n"
        f"Streams: {active_streams}\n"
        f"MRR tracked: ${total_mrr:,}. Capital figure: ${PF['capital']:,}. "
        f"Approvals pending: {len(PF['approvals'])}. Uptime: {uptime_str()}."
    )

def reply_claims_action(text):
    return bool(text and _ACTION_CLAIM.search(text))

def guard_unproven_reply(text, command_ran):
    """Append the honesty note when the model claims work this turn did not do."""
    if command_ran or not text or NO_ACTION_NOTE in text:
        return text
    if reply_claims_action(text):
        return text.rstrip() + "\n" + NO_ACTION_NOTE
    return text

def _one_line_note(text):
    if not text:
        return ""
    line = text.strip().splitlines()[0].strip()
    if not line or line.lower() in ("ok", "okay", "none"):
        return ""
    if reply_claims_action(line):
        return ""
    return line[:180].rstrip()

def _is_action_ask(msg):
    """User asked Hydi to act, or asked for proof of an action."""
    text = (msg or "").strip()
    if re.match(r"(?i)^do\b", text):
        return True
    return bool(re.search(r"(?i)give proof|proof of actions", text))

def _load_board_sdk():
    board_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "lib", "forge-board")
    if board_dir not in sys.path:
        sys.path.insert(0, board_dir)
    import sdk as board
    return board

def _post_ops_request(msg):
    """Data-only REQUEST on Forge Board #ops. Does not execute the ask."""
    body = "REQUEST @Heidi: " + (msg or "").strip()
    try:
        frank_resolve()
    except Exception:
        pass
    try:
        os.environ.setdefault("HYDI_BOARD_SENDER", "hydi-daemon")
        return _load_board_sdk().post("ops", body)
    except Exception:
        return {"ok": False, "error": "board unavailable"}

def _queue_approval(msg, posted):
    """A real pending approval the phone can list. Frank sees the board post."""
    message = posted.get("message") if isinstance(posted, dict) else None
    board_id = message.get("id") if isinstance(message, dict) else None
    item = {
        "id": f"req-{int(time.time() * 1000)}-{len(PF['approvals'])}",
        "agent": "Heidi",
        "title": ((msg or "").strip()[:160] or "phone request"),
        "description": "Phone chat REQUEST for @Heidi on #ops. Not executed until Frank approves it.",
        "priority": "high",
        "meta": ["request", "ops"],
        "board_message_id": board_id,
    }
    PF["approvals"].append(item)
    return item

def _file_action_request(msg):
    """Do the path the prompt names: post the request, queue the approval, cite both."""
    posted = _post_ops_request(msg)
    item = _queue_approval(msg, posted)
    board_id = item.get("board_message_id") or "none"
    return (
        f"{_ops_request_line(posted)}\n"
        f"Approval queued: {item['id']}.\n"
        f"Proof: board={board_id} approval={item['id']}."
    )

def _ops_request_line(result):
    if isinstance(result, dict) and result.get("ok"):
        if result.get("offline"):
            return "Request saved on the phone copy of Forge Board #ops for @Heidi. Nothing was executed."
        return "Request posted to Forge Board #ops for @Heidi. Nothing was executed."
    return "Request was NOT posted to Forge Board #ops. Nothing was executed."

def hydi_reply_ai(msg, session_id="default"):
    """Route message through Groq → Ollama → llama.cpp → scripted."""
    ai_available = ai_ready()
    command = _handle_command(msg)

    if command is not None:
        note = ""
        if ai_available:
            note = _one_line_note(_ai_aside(msg, session_id))
        reply = command if not note else command + "\n" + note
        _remember(session_id, msg, reply)
        return reply

    if _is_action_ask(msg):
        reply = _file_action_request(msg)
        _remember(session_id, msg, reply)
        return reply

    if ai_available:
        history = CHAT_HISTORY.setdefault(session_id, [])
        history.append({"role": "user", "content": msg})
        messages = [{"role": "system", "content": build_system_prompt()}] + history[-MAX_HISTORY:]
        ai = ai_chat(messages)
        if ai:
            ai = guard_unproven_reply(ai, False)
            history.append({"role": "assistant", "content": ai})
            if len(history) > MAX_HISTORY * 2:
                CHAT_HISTORY[session_id] = history[-MAX_HISTORY:]
            return ai

    return _scripted_fallback(msg)

def _ai_aside(msg, session_id):
    """One optional line under a verbatim command result. The result is not sent to paraphrase."""
    messages = [
        {"role": "system", "content": build_system_prompt()},
        {"role": "user", "content": msg},
        {"role": "system", "content":
            "A command result is already shown to the user verbatim. "
            "Reply with one short line that does not repeat it and does not claim any other action. "
            "If you have nothing to add, reply OK."},
    ]
    return ai_chat(messages)

def _remember(session_id, msg, reply):
    history = CHAT_HISTORY.setdefault(session_id, [])
    history.append({"role": "user", "content": msg})
    history.append({"role": "assistant", "content": reply})
    if len(history) > MAX_HISTORY * 2:
        CHAT_HISTORY[session_id] = history[-MAX_HISTORY:]


def _handle_command(msg):
    """Execute state-mutating commands. Returns result string or None if not a command."""
    t = msg.lower().strip()

    if "revenue status" in t or "revenue" in t and "status" in t:
        lines = "\n".join(
            f"  {s}: active  MRR ${PF['revenue_streams'][s]['mrr']:,}"
            for s in REVENUE_STREAMS
        )
        total = sum(s["mrr"] for s in PF["revenue_streams"].values())
        return (
            f"REVENUE ENGINE — PRIMARY DIRECTIVE ACTIVE\n"
            f"Streams ({len(REVENUE_STREAMS)} active):\n{lines}\n"
            f"Total MRR: ${total:,}  |  Capital: ${PF['capital']:,}"
        )

    if "top opportunity" in t or "best opportunity" in t or "top opp" in t:
        return (
            "Top Revenue Opportunities (Priority Order):\n"
            "  1. galactic_bytes  — SaaS subscription upsell → target $2k MRR\n"
            "  2. detailer_bot    — auto-detailing lead gen → activate outreach agent\n"
            "  3. rezonate        — music license sales → deploy marketing agent\n"
            "  4. lipi_v2         — text-to-design → launch beta waitlist\n"
            "  5. waveformer_studio — label mgmt → onboard first artist\n"
            "Type 'grow outreach' to activate outreach sweep."
        )

    if "grow outreach" in t:
        PF["agents"]["outreach"] = "running"
        PF["agents"]["marketing"] = "running"
        PF["actions"] += 8
        PF["approvals"].append({
            "id": f"rev-{int(time.time())}", "agent": "OutreachAI",
            "title": "Revenue Outreach Sweep — All 6 Streams",
            "description": "Deploy targeted outreach across galactic_bytes, detailer_bot, rezonate. Estimated 15 new leads.",
            "priority": "high", "meta": ["revenue", "outreach", "15-leads"],
        })
        return "Outreach + Marketing agents activated. Revenue sweep queued across all 6 streams. Approve in queue to execute."

    if "grow agents" in t or "start all" in t or "start agents" in t:
        started = [k for k, v in PF["agents"].items() if v == "idle"]
        for k in started:
            PF["agents"][k] = "running"
        PF["actions"] += len(started)
        return (f"Started {len(started)} agent slots: {', '.join(started)}. "
                f"{len(PF['agents'])} slots active. Note: the Agents tab shows real "
                "services; these are ProtoForge registry slots."
                if started else "All agent slots were already active.")

    if "grow finance" in t or "finance round" in t:
        PF["capital"] += 10000
        PF["actions"] += 5
        return f"Capital allocation round complete. Deployed: ${PF['capital']:,}."

    if "grow autonomy" in t or (
        "autonomy" in t and any(w in t for w in ("raise", "increase", "up", "higher"))
    ):
        return (
            f"Autonomy level {PF['autonomy_level']} {AUTONOMY_LABEL}. "
            "Nothing was changed."
        )

    if "grow evolution" in t or "evolution cycle" in t:
        PF["actions"] += 20
        return "CASCADE evolution protocol running. Agent policies optimising across the registry."

    if t.startswith("set autonomy "):
        return (
            f"Autonomy level {PF['autonomy_level']} {AUTONOMY_LABEL}. "
            "Nothing was changed."
        )

    if t.startswith("start ") and not t.startswith("start all"):
        name = t[6:].strip()
        if name in PF["agents"]:
            PF["agents"][name] = "running"
            return f"Agent '{name}' started."

    if t.startswith(("stop ", "pause ")):
        name = t.split(" ", 1)[1].strip()
        if name in PF["agents"]:
            PF["agents"][name] = "paused"
            return f"Agent '{name}' paused."

    if t.startswith("approve ") or t.startswith("reject ") or t.startswith("defer "):
        parts = t.split()
        decision, raw = parts[0], parts[1] if len(parts) > 1 else ""
        if raw.isdigit():
            idx = int(raw)
            if 0 <= idx < len(PF["approvals"]):
                item = PF["approvals"].pop(idx)
                return f"{decision.capitalize()}d: {item.get('title', 'request')}."
        return "Invalid index. Type 'approvals' to list pending items."

    return None  # not a command


def _scripted_fallback(msg):
    """Keyword-based replies when Ollama is unavailable."""
    t = msg.lower()

    if any(w in t for w in ("status", "health", "how are")):
        fleet = fleet_status()
        up = sum(1 for i in fleet if i["status"] == "running")
        lines = "\n".join(f"  {i['name']}: {i['status']} — {i['detail']}" for i in fleet)
        return (
            f"System: {'OPERATIONAL' if up else 'DEGRADED'}\n"
            f"Fleet ({up}/{len(fleet)} running):\n{lines}\n"
            f"Autonomy: Level {PF['autonomy_level']} — {AUTONOMY_NAMES[PF['autonomy_level']]} {AUTONOMY_LABEL}\n"
            f"Capital: ${PF['capital']:,}\n"
            f"Approvals pending: {len(PF['approvals'])}\n"
            f"Uptime: {uptime_str()}"
        )

    if any(w in t for w in ("grow", "scale", "expand")):
        return (
            "Growth options:\n"
            "  start all agents  — activate idle agents\n"
            "  grow finance      — capital allocation round\n"
            "  grow autonomy     — display only, nothing changes\n"
            "  grow evolution    — CASCADE evolution cycle"
        )

    if "agent" in t or "fleet" in t:
        fleet = fleet_status()
        lines = "\n".join(f"  {i['name']}: {i['status']} — {i['detail']}" for i in fleet)
        up = sum(1 for i in fleet if i["status"] == "running")
        return f"Live fleet ({up}/{len(fleet)} running):\n{lines}"

    if any(w in t for w in ("financ", "capital", "revenue", "money")):
        return (
            f"Financial Engine:\n"
            f"Capital deployed: ${PF['capital']:,}\n"
            f"Actions: {PF['actions']}  Success: {int(PF['success_rate']*100)}%"
        )

    if any(w in t for w in ("approval", "queue", "pending")):
        if not PF["approvals"]:
            return "No pending approvals. All agents within authorised parameters."
        lines = "\n".join(
            f"  [{i}] {a.get('title','Action')} — {a.get('agent','')}"
            for i, a in enumerate(PF["approvals"])
        )
        return f"{len(PF['approvals'])} pending:\n{lines}\nType 'approve 0' to act."

    if any(w in t for w in ("autonomy", "level")):
        return (
            f"Autonomy: Level {PF['autonomy_level']} — {AUTONOMY_NAMES[PF['autonomy_level']]} {AUTONOMY_LABEL}\n"
            "Levels: 0 Observe · 1 Assist · 2 Approve · 3 Conditional · 4 Full Auto\n"
            "This number is not wired to an executor."
        )

    if any(w in t for w in ("help", "commands", "what can")):
        return HELP_TEXT

    if t in ("hi", "hello", "hey", "yo"):
        return "Hydi online — ProtoForge Command ready. Type 'status' or 'help'."

    up = sum(1 for i in fleet_status() if i["status"] == "running")
    return (
        f"Processing: \"{msg[:60]}{'...' if len(msg)>60 else ''}\"\n"
        f"{up} fleet services running. Type 'help' for commands.\n"
        "(Tip: install Ollama for intelligent AI replies)"
    )


HELP_TEXT = """\
Hydi Commands:
──────────────────────────
status / health      system overview
agents               agent mesh status
start <name>         start a specific agent
stop <name>          pause a specific agent
start all agents     activate all idle agents
grow                 growth options menu
grow agents          start all idle agents
grow finance         capital allocation round
grow autonomy        display only — no executor connected
grow evolution       CASCADE evolution cycle
set autonomy <0-4>   display only — does not change the level
autonomy             display only — no executor connected
approvals            list pending approvals
approve <n>          approve item n
reject <n>           reject item n
finance / capital    financial engine status
help                 this list
exit / quit          stop Hydi"""

# ── TTS ──────────────────────────────────────────────────
def speak(text):
    try:
        subprocess.run(
            ["termux-tts-speak", text[:200]],
            timeout=15,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
    except Exception:
        pass

def speak_async(text):
    threading.Thread(target=speak, args=(text,), daemon=True).start()

# ── Utilities ─────────────────────────────────────────────
def uptime_str():
    s = int(time.time() - PF["start_time"])
    h, r = divmod(s, 3600)
    m, s = divmod(r, 60)
    return f"{h}h {m}m {s}s"

def log_event(text, severity="ok"):
    PF["events"].insert(0, {"text": text, "severity": severity, "ts": time.ctime()})
    PF["events"] = PF["events"][:50]

def local_ip():
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception:
        return "localhost"

# ── HTTP handler ─────────────────────────────────────────
class HydiHandler(BaseHTTPRequestHandler):

    def log_message(self, fmt, *args):
        pass

    def do_OPTIONS(self):
        self.send_response(200)
        self._cors()
        self.end_headers()

    def do_GET(self):
        p = urlparse(self.path).path.rstrip("/") or "/"

        if p in ("/", "/hydi", "/index"):
            self._serve_html()
        elif p == "/api/health":
            self._json(health_payload())
        elif p == "/api/protoforge/stats":
            PF["actions"] += 1
            self._json(stats_payload())
        elif p == "/api/protoforge/agents":
            self._json([{"id": i["id"], "status": i["status"]}
                        for i in fleet_status()])
        elif p == "/api/fleet":
            self._json({"items": fleet_status(), "link": frank_link(),
                        "uptime": uptime_str()})
        elif p == "/api/protoforge/events":
            self._json(PF["events"][:20])
        elif p == "/api/protoforge/revenue":
            total_mrr = sum(s["mrr"] for s in PF["revenue_streams"].values())
            self._json({
                "primary_directive": PF["primary_directive"],
                "streams": PF["revenue_streams"],
                "total_mrr": total_mrr,
                "capital": PF["capital"],
                "stream_count": len(REVENUE_STREAMS),
            })
        elif p == "/api/models":
            self._json(models_payload())
        elif p == "/board":
            self._serve_board()
        elif p == "/api/board":
            self._board("GET")
        elif p == "/manifest.json":
            self._raw(MANIFEST_JSON.encode(), "application/manifest+json")
        elif p == "/sw.js":
            self._raw(SW_JS.encode(), "application/javascript")
        else:
            self.send_response(404); self.end_headers()

    def do_POST(self):
        length  = int(self.headers.get("Content-Length", 0))
        raw     = self.rfile.read(length) if length else b""
        p       = urlparse(self.path).path.rstrip("/") or "/"
        if p == "/api/board":
            if length > 8192:
                self._board_json(413, {"ok": False, "error": "body too large"})
                return
            self._board("POST", raw or b"{}")
            return
        body    = json.loads(raw or b"{}")
        session = self.headers.get("X-Session-Id", "default")

        if p == "/api/chat":
            msg   = body.get("message", "")
            reply = hydi_reply_ai(msg, session)
            log_event(f"Chat: {msg[:50]}", "info")
            self._json({"response": reply, "system": "hydi",
                        "model": active_ai_label()})

        elif p == "/api/protoforge/autonomy":
            self._json({
                "autonomy_level": PF["autonomy_level"],
                "display_only": True,
                "note": AUTONOMY_LABEL,
            })

        elif p.startswith("/api/protoforge/agents/"):
            parts     = p.split("/")
            agent_id  = parts[4] if len(parts) > 4 else ""
            cmd       = parts[5] if len(parts) > 5 else ""
            status_map = {"start": "running", "pause": "paused",
                          "restart": "running", "stop": "idle"}
            if agent_id in PF["agents"] and cmd in status_map:
                PF["agents"][agent_id] = status_map[cmd]
                log_event(f"Agent {agent_id} → {cmd}", "ok")
            self._json({"agentId": agent_id,
                        "status": PF["agents"].get(agent_id, "unknown")})

        elif p == "/api/protoforge/grow":
            action = body.get("action", "")
            PF["actions"] += 10
            log_event(f"Grow: {action}", "ok")
            self._json({"queued": action})

        elif p == "/api/protoforge/approval":
            aid      = body.get("approvalId", "")
            decision = body.get("decision", "")
            PF["approvals"] = [a for a in PF["approvals"] if a.get("id") != aid]
            log_event(f"Approval {decision}: {aid}", "ok" if decision == "approve" else "warn")
            self._json({"approvalId": aid, "decision": decision})

        elif p == "/api/ollama/reload":
            refresh_backends()
            self._json(models_payload())

        else:
            self.send_response(404); self.end_headers()

    # ── send helpers ──────────────────────────────────────
    def _cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers",
                         "Content-Type, Authorization, X-Session-Id")

    def _raw(self, data, content_type="application/octet-stream"):
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", len(data))
        self._cors()
        self.end_headers()
        self.wfile.write(data)

    def _json(self, obj):
        self._raw(json.dumps(obj).encode(), "application/json")

    def _serve_html(self):
        here     = os.path.dirname(os.path.abspath(__file__))
        html_path = os.path.join(here, "hydi-mobile-protoforge.html")
        if os.path.exists(html_path):
            with open(html_path, "rb") as f:
                data = f.read()
        else:
            data = FALLBACK_HTML.encode()
        self._raw(data, "text/html; charset=utf-8")

    def _board_dir(self):
        return os.path.join(os.path.dirname(os.path.abspath(__file__)), "lib", "forge-board")

    def _serve_board(self):
        html_path = os.path.join(self._board_dir(), "ui.html")
        with open(html_path, "rb") as fh:
            data = fh.read()
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(data)))
        self._cors()
        self.end_headers()
        self.wfile.write(data)

    def _board_json(self, status, payload):
        data = json.dumps(payload).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(data)))
        self._cors()
        self.end_headers()
        self.wfile.write(data)

    def _board(self, method, raw=b""):
        board_dir = self._board_dir()
        if board_dir not in sys.path:
            sys.path.insert(0, board_dir)
        frank_resolve()  # refresh HYDI_BOARD_UPSTREAM for the store
        import store
        if method == "POST":
            try:
                incoming = json.loads(raw.decode() or "{}")
            except json.JSONDecodeError:
                self._board_json(400, {"ok": False, "error": "invalid json"})
                return
        else:
            incoming = {}
        query = {key: values[0] for key, values in parse_qs(urlparse(self.path).query).items()}
        result = store.handle_http({
            "method": method,
            "query": query,
            "body": incoming,
            "authorization": self.headers.get("Authorization", ""),
            "client_ip": self.client_address[0],
        })
        if result.get("offline"):
            _frank_note_failure()  # upstream may have moved links; re-probe next call
        result["link"] = frank_link() if frank_candidates() else None
        status = int(result.pop("status", 200))
        self._board_json(status, result)


# ── Payload builders ──────────────────────────────────────
def health_payload():
    return {
        "current_status":  "OK",
        "jobs_queued":     len(PF["approvals"]),
        "trend_status":    "STABLE",
        "auto_heals_24h":  3,
        "last_check":      time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }

def stats_payload():
    fleet = fleet_status()
    return {
        "capital_deployed":  PF["capital"],
        "agent_actions":     PF["actions"],
        "success_rate":      PF["success_rate"],
        "trust_score":       PF["trust_score"],
        "autonomy_level":    PF["autonomy_level"],
        "agents_running":    sum(1 for i in fleet if i["status"] == "running"),
        "agents_total":      len(fleet),
        "approvals_pending": len(PF["approvals"]),
        "uptime":            uptime_str(),
        "ollama_model":      active_ai_label(),
    }


# ── Embedded fallback HTML (minimal, no external deps) ───
FALLBACK_HTML = """\
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no,viewport-fit=cover">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="theme-color" content="#0a0a0f">
<title>Hydi</title>
<style>
*{box-sizing:border-box;margin:0;padding:0;-webkit-tap-highlight-color:transparent}
:root{--bg0:#08080e;--bg1:#0f0f18;--bg2:#161622;--accent:#64ffda;--txt0:#e2e8f0;--txt1:#94a3b8;--txt2:#64748b;--ok:#10b981}
html,body{height:100%;background:var(--bg0);color:var(--txt0);font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif}
#app{display:flex;flex-direction:column;height:100dvh}
.hdr{height:56px;background:var(--bg1);border-bottom:1px solid rgba(255,255,255,.06);display:flex;align-items:center;padding:0 14px;gap:10px;flex-shrink:0}
.orb{width:34px;height:34px;border-radius:50%;background:conic-gradient(from 180deg,#64ffda,#7c6aff,#ff6ac1,#64ffda);display:flex;align-items:center;justify-content:center;font-size:16px;animation:spin 8s linear infinite;flex-shrink:0}
@keyframes spin{to{filter:hue-rotate(360deg)}}
.model-badge{margin-left:auto;font-size:10px;padding:3px 8px;border-radius:100px;background:rgba(100,255,218,.1);color:var(--accent);border:1px solid rgba(100,255,218,.2)}
.msgs{flex:1;overflow-y:auto;padding:12px;display:flex;flex-direction:column;gap:10px;-webkit-overflow-scrolling:touch}
.msg{max-width:84%;animation:in .25s ease}
@keyframes in{from{opacity:0;transform:translateY(8px)}}
.msg.u{align-self:flex-end}.msg.h{align-self:flex-start}.msg.s{align-self:center;max-width:92%}
.bbl{padding:10px 14px;border-radius:18px;font-size:15px;line-height:1.5;white-space:pre-wrap;word-break:break-word}
.msg.u .bbl{background:var(--accent);color:#000;border-bottom-right-radius:4px;font-weight:500}
.msg.h .bbl{background:#1e1e2e;border:1px solid rgba(255,255,255,.08);border-bottom-left-radius:4px}
.msg.s .bbl{background:rgba(100,255,218,.06);border:1px solid rgba(100,255,218,.15);font-size:12px;text-align:center;color:var(--txt1)}
.mt{font-size:10px;color:var(--txt2);margin-top:3px;padding:0 4px}.msg.u .mt{text-align:right}
.chips{background:var(--bg1);border-top:1px solid rgba(255,255,255,.04);padding:8px 12px;display:flex;gap:7px;overflow-x:auto;scrollbar-width:none;flex-shrink:0}
.chips::-webkit-scrollbar{display:none}
.chip{padding:6px 12px;border-radius:100px;background:#161622;border:1px solid rgba(255,255,255,.08);font-size:12px;color:var(--txt1);white-space:nowrap;cursor:pointer;flex-shrink:0}
.chip:active{background:rgba(100,255,218,.1);color:var(--accent)}
.inp{background:var(--bg1);border-top:1px solid rgba(255,255,255,.06);padding:10px 12px;padding-bottom:max(10px,env(safe-area-inset-bottom));flex-shrink:0}
.row{display:flex;gap:8px;align-items:flex-end}
textarea{flex:1;background:#161622;border:1px solid rgba(255,255,255,.1);border-radius:20px;padding:9px 14px;font-size:15px;color:var(--txt0);resize:none;max-height:100px;outline:none;font-family:inherit;line-height:1.4}
textarea:focus{border-color:rgba(100,255,218,.4)}
.send{width:40px;height:40px;border-radius:50%;background:var(--accent);border:none;display:flex;align-items:center;justify-content:center;cursor:pointer;flex-shrink:0}
.send:active{transform:scale(.93)}.send:disabled{opacity:.4}
.send svg{width:17px;height:17px;fill:#000}
.tdots{background:#1e1e2e;border:1px solid rgba(255,255,255,.08);border-bottom-left-radius:4px;border-radius:18px;padding:11px 16px;display:flex;gap:5px}
.tdots span{width:7px;height:7px;border-radius:50%;background:var(--txt2);animation:td 1.2s infinite}
.tdots span:nth-child(2){animation-delay:.2s}.tdots span:nth-child(3){animation-delay:.4s}
@keyframes td{0%,80%,100%{transform:scale(.7);opacity:.5}40%{transform:scale(1);opacity:1}}
</style>
</head>
<body>
<div id="app">
  <div class="hdr">
    <div class="orb">🧠</div>
    <div><div style="font-size:16px;font-weight:700">Hydi</div>
         <div style="font-size:11px;color:var(--txt2)">ProtoForge Command</div></div>
    <div class="model-badge" id="mb">Loading...</div>
  </div>
  <div class="msgs" id="msgs">
    <div class="msg s"><div class="bbl">🧠 Hydi online. Checking AI model...</div></div>
  </div>
  <div class="chips">
    <span class="chip" onclick="sc('revenue status')">Revenue</span>
    <span class="chip" onclick="sc('status')">Status</span>
    <span class="chip" onclick="sc('top opportunity')">Top Opp</span>
    <span class="chip" onclick="sc('grow outreach')">Outreach</span>
    <span class="chip" onclick="sc('grow finance')">Finance</span>
    <span class="chip" onclick="sc('approvals')">Approvals</span>
    <span class="chip" onclick="sc('agents')">Agents</span>
    <span class="chip" onclick="sc('help')">Help</span>
  </div>
  <div class="inp">
    <div class="row">
      <textarea id="ti" placeholder="Message Hydi..." rows="1"
        oninput="ar(this)" onkeydown="kd(event)"></textarea>
      <button class="send" id="sb" onclick="snd()">
        <svg viewBox="0 0 24 24"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>
      </button>
    </div>
  </div>
</div>
<script>
const SESSION = 'sess_' + Math.random().toString(36).slice(2);
function esc(s){const d=document.createElement('div');d.textContent=s;return d.innerHTML}
function ts(){return new Date().toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})}
function add(cls,txt,model){
  const b=document.getElementById('msgs');
  const d=document.createElement('div');d.className='msg '+cls;
  const sub=cls==='u'?'You':(model&&model!=='scripted'?'Hydi ('+model.split(':')[0]+')':'Hydi');
  d.innerHTML='<div class="bbl">'+esc(txt)+'</div><div class="mt">'+sub+' · '+ts()+'</div>';
  b.appendChild(d);b.scrollTop=b.scrollHeight;
}
function showTyping(){
  const b=document.getElementById('msgs');if(document.getElementById('ty'))return;
  const d=document.createElement('div');d.className='msg h';d.id='ty';
  d.innerHTML='<div class="tdots"><span></span><span></span><span></span></div>';
  b.appendChild(d);b.scrollTop=b.scrollHeight;
}
function hideTyping(){document.getElementById('ty')?.remove()}
async function snd(){
  const ti=document.getElementById('ti');const msg=ti.value.trim();if(!msg)return;
  add('u',msg);ti.value='';ar(ti);showTyping();
  try{
    const r=await fetch('/api/chat',{method:'POST',
      headers:{'Content-Type':'application/json','X-Session-Id':SESSION},
      body:JSON.stringify({message:msg})});
    const d=await r.json();hideTyping();add('h',d.response||'...',d.model);
  }catch{hideTyping();add('h','Connection error — is Hydi server running?');}
}
function sc(t){document.getElementById('ti').value=t;snd()}
function ar(el){el.style.height='auto';el.style.height=Math.min(el.scrollHeight,100)+'px'}
function kd(e){if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();snd()}}
// Load model info
fetch('/api/models').then(r=>r.json()).then(d=>{
  const mb=document.getElementById('mb');
  if(d.mode==='ai'&&d.active_model){mb.textContent='🤖 '+d.active_model.split(':')[0].split('/').pop();mb.style.color='var(--accent)';}
  else{mb.textContent='📝 Scripted';mb.style.color='var(--txt2)';}
  add('s',d.mode==='ai'
    ?'Connected to '+d.active_model+'. Ask me anything about ProtoForge!'
    :'No model server. Start Ollama, or the hydi llama.cpp service on port 8080.');
}).catch(()=>{document.getElementById('mb').textContent='Offline'});
</script>
</body>
</html>
"""

MANIFEST_JSON = json.dumps({
    "name": "Hydi — ProtoForge Command",
    "short_name": "Hydi",
    "start_url": "/",
    "display": "standalone",
    "background_color": "#0a0a0f",
    "theme_color": "#0a0a0f",
    "icons": [{"src": "/icon-192.png", "sizes": "192x192",
               "type": "image/png", "purpose": "any maskable"}]
})

SW_JS = """\
const C='hydi-v2';
self.addEventListener('install',e=>{e.waitUntil(caches.open(C).then(c=>c.addAll(['/','/manifest.json'])).then(()=>self.skipWaiting()))});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k!==C).map(k=>caches.delete(k)))).then(()=>self.clients.claim()))});
self.addEventListener('fetch',e=>{if(e.request.url.includes('/api/'))return;e.respondWith(caches.match(e.request).then(r=>r||fetch(e.request).then(res=>{if(res.ok){const cl=res.clone();caches.open(C).then(c=>c.put(e.request,cl))}return res}).catch(()=>caches.match('/'))))});
"""

# ── CLI ───────────────────────────────────────────────────
BANNER = """
  ██╗  ██╗██╗   ██╗██████╗ ██╗
  ██║  ██║╚██╗ ██╔╝██╔══██╗██║
  ███████║ ╚████╔╝ ██║  ██║██║
  ██╔══██║  ╚██╔╝  ██║  ██║██║
  ██║  ██║   ██║   ██████╔╝██║
  ╚═╝  ╚═╝   ╚═╝   ╚═════╝ ╚═╝
  ProtoForge Command  v2.1
"""

def cli_loop():
    print(BANNER)
    if GROQ_MODEL:
        print(f"  🤖 Groq AI : {GROQ_MODEL}")
    elif OLLAMA_MODEL:
        print(f"  🤖 Ollama  : {OLLAMA_MODEL}")
    elif LLAMA_MODEL:
        print(f"  🤖 llama.cpp : {LLAMA_MODEL}  ({LLAMA_URL})")
    else:
        print("  📝 Scripted mode — no AI backend detected")
        print("     Groq (free, phone-friendly): console.groq.com → get API key")
        print("     then: export GROQ_API_KEY=gsk_xxx  and restart hydi")
    print("  Type 'help' for commands, 'exit' to quit.\n")

    while True:
        try:
            msg = input("hydi> ").strip()
        except (EOFError, KeyboardInterrupt):
            print("\nBye.")
            break

        if not msg:
            continue
        if msg.lower() in ("exit", "quit", "bye", "/bye"):
            print("Shutting down. Goodbye.")
            break

        reply = hydi_reply_ai(msg, session_id="cli")
        print(f"\n{reply}\n")
        speak_async(reply)


# ── Server ────────────────────────────────────────────────
def start_server(port=3006, host="0.0.0.0"):
    from http.server import ThreadingHTTPServer
    server = ThreadingHTTPServer((host, port), HydiHandler)
    ip = local_ip()

    print(BANNER)
    if GROQ_MODEL:
        print(f"  🤖 Groq AI : {GROQ_MODEL}  (cloud, fast)")
    elif OLLAMA_MODEL:
        where = ("remote: " + ollama_base()) if ollama_is_remote() else "local"
        print(f"  🤖 Ollama  : {OLLAMA_MODEL}  ({where})")
    elif LLAMA_MODEL:
        print(f"  🤖 llama.cpp : {LLAMA_MODEL}  ({LLAMA_URL})")
    else:
        print("  📝 Scripted mode — no AI backend detected")
        print("     → Get a free Groq API key at console.groq.com")
        print("     → export GROQ_API_KEY=gsk_xxx  then restart hydi")
    print()
    print(f"  PRIMARY DIRECTIVE     : REVENUE GENERATION")
    print(f"  Autonomy              : Level {PF['autonomy_level']} — {AUTONOMY_NAMES[PF['autonomy_level']]} {AUTONOMY_LABEL}")
    print(f"  Revenue streams       : {len(REVENUE_STREAMS)} active")
    print(f"  Agents                : ALL 15 RUNNING")
    print()
    print(f"  Open on your phone : http://{ip}:{port}/")
    print(f"  Forge Board        : http://{ip}:{port}/board")
    print(f"  Local              : http://localhost:{port}/")
    print(f"  Revenue API        : http://localhost:{port}/api/protoforge/revenue")
    print(f"  Models             : http://localhost:{port}/api/models")
    print()
    print("  Share → Add to Home Screen to install as an app.")
    print("  Ctrl+C to stop.\n")

    # Demo approval after 5s
    def _demo():
        time.sleep(5)
        PF["approvals"].append({
            "id": "demo-001", "agent": "FinanceAI",
            "title": "Initial Capital Allocation",
            "description": "Deploy $50,000 seed capital across ops, marketing, infrastructure.",
            "priority": "high", "meta": ["$50,000", "seed-round"],
        })
        log_event("Approval pending: Initial Capital Allocation", "warn")
    threading.Thread(target=_demo, daemon=True).start()

    def _board_online():
        try:
            board_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "lib", "forge-board")
            if board_dir not in sys.path:
                sys.path.insert(0, board_dir)
            os.environ.setdefault("HYDI_BOARD_SENDER", "hydi-daemon")
            import sdk as board
            board.post("general", "hydi-daemon online")
            import store
            store.start_outbox_sync()
        except Exception:
            pass
    threading.Thread(target=_board_online, daemon=True).start()

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nShutting down.")
        server.shutdown()


# ── Entry ─────────────────────────────────────────────────
def main():
    # Check Groq first (fast, phone-friendly)
    print("Checking Groq... ", end=" ", flush=True)
    if detect_groq():
        print(f"✅ {GROQ_MODEL}")
    else:
        reason = "no GROQ_API_KEY set" if not GROQ_API_KEY else "key invalid or network error"
        print(f"not available ({reason})")
        # Fall back to Ollama
        print("Checking Ollama...", end=" ", flush=True)
        if detect_ollama():
            print(f"✅ {OLLAMA_MODEL}")
        else:
            print("not found")
            print("Checking llama.cpp...", end=" ", flush=True)
            if detect_llama():
                print(f"✅ {LLAMA_MODEL}")
            else:
                print("not found → scripted mode")

    args = sys.argv[1:]
    if not args:
        start_server()
    elif args[0] == "cli":
        cli_loop()
    elif args[0] == "server":
        port = int(args[1]) if len(args) > 1 else 3006
        start_server(port=port)
    else:
        msg   = " ".join(args)
        reply = hydi_reply_ai(msg)
        print(reply)
        speak_async(reply)

if __name__ == "__main__":
    main()
