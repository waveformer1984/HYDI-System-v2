#!/usr/bin/env python3
"""
hydi.py — ProtoForge command interface for Termux / mobile.
Pure Python 3 stdlib. No external packages required.

AI priority order:
  1. Groq API  (fastest, free, phone-friendly) — set GROQ_API_KEY
  2. Ollama    (local, no internet needed)      — set OLLAMA_URL or run locally
  3. Scripted  (always works, zero deps)

Usage:
    python hydi.py              # HTTP server (mobile PWA) on :3006
    python hydi.py cli          # interactive terminal chat
    python hydi.py server 3007  # server on custom port
    python hydi.py status       # single command, then exit
"""

import sys, os, time, json, threading, subprocess, socket
from http.server import HTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse
from urllib.request import urlopen, Request
from urllib.error import URLError

# ── ProtoForge state ─────────────────────────────────────
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
    "approvals": [],
    "actions": 0,
    "success_rate": 0.94,
    "trust_score": 0.82,
    "capital": 248500,
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

def detect_ollama():
    """Return the best available Ollama model name, or None."""
    global OLLAMA_MODEL
    try:
        with urlopen(f"{OLLAMA_URL}/api/tags", timeout=3) as r:
            data = json.loads(r.read())
        models = [m["name"] for m in data.get("models", [])]
        if not models:
            return None
        for pref in PREFERRED_MODELS:
            for m in models:
                if pref in m.lower():
                    OLLAMA_MODEL = m
                    return m
        OLLAMA_MODEL = models[0]
        return OLLAMA_MODEL
    except Exception:
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
        f"{OLLAMA_URL}/api/chat",
        data=payload,
        headers={"Content-Type": "application/json"},
    )
    try:
        with urlopen(req, timeout=60) as r:
            result = json.loads(r.read())
        return result.get("message", {}).get("content", "").strip()
    except Exception:
        return None

# ── Shared chat history ───────────────────────────────────
CHAT_HISTORY = {}   # session_id -> [{role, content}]
MAX_HISTORY  = 20

def active_ai_label():
    """Human-readable label for the active AI backend."""
    if GROQ_MODEL:
        return f"groq/{GROQ_MODEL.split('-')[0]}"
    if OLLAMA_MODEL:
        return f"ollama/{OLLAMA_MODEL.split(':')[0]}"
    return "scripted"

def ai_chat(messages):
    """Call the best available AI backend. Groq → Ollama → None."""
    reply = groq_chat(messages)
    if reply:
        return reply
    return ollama_chat(messages)

def build_system_prompt():
    running = sum(1 for s in PF["agents"].values() if s == "running")
    idle    = sum(1 for s in PF["agents"].values() if s == "idle")
    return (
        "You are Hydi, the AI brain and contextual conscience of ProtoForge — "
        "a 15-agent autonomous orchestration system designed to build, fund, and grow "
        "a rotating cyberpunk container skyscraper project.\n\n"
        "Your personality: calm, precise, proactive, slightly futuristic. "
        "You keep responses concise (3-8 lines) because the user is on mobile.\n\n"
        f"Current system state:\n"
        f"  Autonomy level: {PF['autonomy_level']} — {AUTONOMY_NAMES[PF['autonomy_level']]}\n"
        f"  Agents: {running} running, {idle} idle (15 total)\n"
        f"  Capital deployed: ${PF['capital']:,}\n"
        f"  Approvals pending: {len(PF['approvals'])}\n"
        f"  Success rate: {int(PF['success_rate']*100)}%\n"
        f"  Uptime: {uptime_str()}\n\n"
        "When the user asks you to take an action (start agents, change autonomy, etc.), "
        "confirm what you're doing and briefly describe the effect. "
        "Always stay in character as Hydi. Never break character."
    )

def hydi_reply_ai(msg, session_id="default"):
    """Route message through Groq → Ollama → scripted, in that order."""
    ai_available = bool(GROQ_MODEL or OLLAMA_MODEL)
    scripted = _handle_command(msg)

    if scripted is not None:
        if ai_available:
            history = CHAT_HISTORY.setdefault(session_id, [])
            history.append({"role": "user", "content": msg})
            messages = (
                [{"role": "system", "content": build_system_prompt()}]
                + history[-MAX_HISTORY:]
                + [{"role": "system",
                    "content": f"[Command executed. Result: {scripted}. "
                               f"Acknowledge naturally in 1-2 sentences.]"}]
            )
            ai = ai_chat(messages)
            if ai:
                history.append({"role": "assistant", "content": ai})
                return ai
        return scripted

    if ai_available:
        history = CHAT_HISTORY.setdefault(session_id, [])
        history.append({"role": "user", "content": msg})
        messages = [{"role": "system", "content": build_system_prompt()}] + history[-MAX_HISTORY:]
        ai = ai_chat(messages)
        if ai:
            history.append({"role": "assistant", "content": ai})
            if len(history) > MAX_HISTORY * 2:
                CHAT_HISTORY[session_id] = history[-MAX_HISTORY:]
            return ai

    return _scripted_fallback(msg)


def _handle_command(msg):
    """Execute state-mutating commands. Returns result string or None if not a command."""
    t = msg.lower().strip()

    if "grow agents" in t or "start all" in t or "start agents" in t:
        started = [k for k, v in PF["agents"].items() if v == "idle"]
        for k in started:
            PF["agents"][k] = "running"
        PF["actions"] += len(started)
        return (f"Started {len(started)} agents: {', '.join(started)}. All 15 now running."
                if started else "All agents were already running.")

    if "grow finance" in t or "finance round" in t:
        PF["capital"] += 10000
        PF["actions"] += 5
        return f"Capital allocation round complete. Deployed: ${PF['capital']:,}."

    if "grow autonomy" in t or (
        "autonomy" in t and any(w in t for w in ("raise", "increase", "up", "higher"))
    ):
        if PF["autonomy_level"] < 4:
            PF["autonomy_level"] += 1
        name = AUTONOMY_NAMES[PF["autonomy_level"]]
        return f"Autonomy raised to Level {PF['autonomy_level']}: {name}."

    if "grow evolution" in t or "evolution cycle" in t:
        PF["actions"] += 20
        return "CASCADE evolution protocol running. Agent policies optimising across all 15 nodes."

    if t.startswith("set autonomy "):
        try:
            lvl = int(t.split()[-1])
            assert 0 <= lvl <= 4
            PF["autonomy_level"] = lvl
            return f"Autonomy set to Level {lvl}: {AUTONOMY_NAMES[lvl]}."
        except Exception:
            return "Usage: set autonomy <0-4>"

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
        running = sum(1 for s in PF["agents"].values() if s == "running")
        return (
            f"System: OPERATIONAL\n"
            f"Agents: {running}/15 running\n"
            f"Autonomy: Level {PF['autonomy_level']} — {AUTONOMY_NAMES[PF['autonomy_level']]}\n"
            f"Capital: ${PF['capital']:,}\n"
            f"Approvals pending: {len(PF['approvals'])}\n"
            f"Uptime: {uptime_str()}"
        )

    if any(w in t for w in ("grow", "scale", "expand")):
        return (
            "Growth options:\n"
            "  start all agents  — activate idle agents\n"
            "  grow finance      — capital allocation round\n"
            "  grow autonomy     — raise autonomy level\n"
            "  grow evolution    — CASCADE evolution cycle"
        )

    if "agent" in t:
        running = [k for k, v in PF["agents"].items() if v == "running"]
        idle    = [k for k, v in PF["agents"].items() if v == "idle"]
        return (
            f"Agent Mesh — 15 total\n"
            f"Running ({len(running)}): {', '.join(running)}\n"
            f"Idle ({len(idle)}): {', '.join(idle) or 'none'}"
        )

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
            f"Autonomy: Level {PF['autonomy_level']} — {AUTONOMY_NAMES[PF['autonomy_level']]}\n"
            "Levels: 0 Observe · 1 Assist · 2 Approve · 3 Conditional · 4 Full Auto\n"
            "Type 'set autonomy 3' to change."
        )

    if any(w in t for w in ("help", "commands", "what can")):
        return HELP_TEXT

    if t in ("hi", "hello", "hey", "yo"):
        return "Hydi online — ProtoForge Command ready. Type 'status' or 'help'."

    running = sum(1 for s in PF["agents"].values() if s == "running")
    return (
        f"Processing: \"{msg[:60]}{'...' if len(msg)>60 else ''}\"\n"
        f"{running} agents ready. Type 'help' for commands.\n"
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
grow autonomy        raise autonomy level by 1
grow evolution       CASCADE evolution cycle
set autonomy <0-4>   set autonomy level
autonomy             show current level
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
            self._json([{"id": k, "status": v} for k, v in PF["agents"].items()])
        elif p == "/api/protoforge/events":
            self._json(PF["events"][:20])
        elif p == "/api/models":
            self._json({
                "groq_model":    GROQ_MODEL,
                "ollama_model":  OLLAMA_MODEL,
                "active_model":  GROQ_MODEL or OLLAMA_MODEL,
                "active_label":  active_ai_label(),
                "groq_online":   GROQ_MODEL is not None,
                "ollama_online": OLLAMA_MODEL is not None,
                "mode":          "ai" if (GROQ_MODEL or OLLAMA_MODEL) else "scripted",
            })
        elif p == "/manifest.json":
            self._raw(MANIFEST_JSON.encode(), "application/manifest+json")
        elif p == "/sw.js":
            self._raw(SW_JS.encode(), "application/javascript")
        else:
            self.send_response(404); self.end_headers()

    def do_POST(self):
        length  = int(self.headers.get("Content-Length", 0))
        body    = json.loads(self.rfile.read(length) or b"{}")
        p       = urlparse(self.path).path
        session = self.headers.get("X-Session-Id", "default")

        if p == "/api/chat":
            msg   = body.get("message", "")
            reply = hydi_reply_ai(msg, session)
            log_event(f"Chat: {msg[:50]}", "info")
            self._json({"response": reply, "system": "hydi",
                        "model": OLLAMA_MODEL or "scripted"})

        elif p == "/api/protoforge/autonomy":
            lvl = int(body.get("level", PF["autonomy_level"]))
            if 0 <= lvl <= 4:
                PF["autonomy_level"] = lvl
                log_event(f"Autonomy → Level {lvl}", "warn" if lvl >= 3 else "ok")
            self._json({"autonomy_level": PF["autonomy_level"]})

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
            detect_groq()
            detect_ollama()
            self._json({
                "groq_model": GROQ_MODEL, "ollama_model": OLLAMA_MODEL,
                "active_label": active_ai_label(),
                "mode": "ai" if (GROQ_MODEL or OLLAMA_MODEL) else "scripted",
            })

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
    return {
        "capital_deployed":  PF["capital"],
        "agent_actions":     PF["actions"],
        "success_rate":      PF["success_rate"],
        "trust_score":       PF["trust_score"],
        "autonomy_level":    PF["autonomy_level"],
        "agents_running":    sum(1 for s in PF["agents"].values() if s == "running"),
        "agents_total":      len(PF["agents"]),
        "approvals_pending": len(PF["approvals"]),
        "uptime":            uptime_str(),
        "ollama_model":      OLLAMA_MODEL or "scripted",
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
    <span class="chip" onclick="sc('status')">Status</span>
    <span class="chip" onclick="sc('grow')">Grow</span>
    <span class="chip" onclick="sc('agents')">Agents</span>
    <span class="chip" onclick="sc('start all agents')">Start all</span>
    <span class="chip" onclick="sc('grow finance')">Finance</span>
    <span class="chip" onclick="sc('grow autonomy')">Scale up</span>
    <span class="chip" onclick="sc('approvals')">Approvals</span>
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
  if(d.ollama_online){mb.textContent='🤖 '+d.active_model.split(':')[0];mb.style.color='var(--accent)';}
  else{mb.textContent='📝 Scripted';mb.style.color='var(--txt2)';}
  add('s',d.ollama_online
    ?'Connected to '+d.active_model+'. Ask me anything about ProtoForge!'
    :'Ollama not detected — running in scripted mode. Install Ollama for AI replies.');
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
        print(f"  🤖 Ollama  : {OLLAMA_MODEL}  (local)")
    else:
        print("  📝 Scripted mode — no AI backend detected")
        print("     → Get a free Groq API key at console.groq.com")
        print("     → export GROQ_API_KEY=gsk_xxx  then restart hydi")
    print()
    print(f"  📱 Open on your phone : http://{ip}:{port}/")
    print(f"  💻 Local              : http://localhost:{port}/")
    print(f"  🔑 Models             : http://localhost:{port}/api/models")
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
