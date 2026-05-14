#!/usr/bin/env python3
"""
hydi.py — Standalone ProtoForge command interface for Termux / mobile.
No external packages required. Pure Python 3 stdlib.

Usage:
    python hydi.py          # start server + open browser
    python hydi.py cli      # interactive CLI only
    python hydi.py <cmd>    # run single command and exit
"""

import sys, os, time, json, threading, subprocess, socket
from http.server import HTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs
import io

# ── ProtoForge state ─────────────────────────────────────
PF = {
    "autonomy_level": 2,
    "agents": {
        "architect":  "running", "engineer":   "running",
        "finance":    "running", "legal":      "idle",
        "marketing":  "idle",    "ops":        "running",
        "analytics":  "running", "cascade":    "running",
        "heidi":      "running", "ursula":     "idle",
        "security":   "running", "realtime":   "running",
        "outreach":   "idle",    "memory":     "idle",
        "executive":  "running",
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

# ── TTS (Termux) ─────────────────────────────────────────
def speak(text):
    """Say text aloud using Termux TTS if available."""
    try:
        subprocess.run(
            ["termux-tts-speak", text],
            timeout=10,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
    except Exception:
        pass  # silently skip if termux-tts-speak not installed

def speak_async(text):
    threading.Thread(target=speak, args=(text,), daemon=True).start()

# ── Hydi reply engine ────────────────────────────────────
def hydi_reply(msg):
    t = msg.lower()

    if any(w in t for w in ("status", "health", "how are")):
        running = sum(1 for s in PF["agents"].values() if s == "running")
        reply = (
            f"System: OPERATIONAL\n"
            f"Agents running: {running}/15\n"
            f"Autonomy: Level {PF['autonomy_level']} — {AUTONOMY_NAMES[PF['autonomy_level']]}\n"
            f"Approvals pending: {len(PF['approvals'])}\n"
            f"Actions today: {PF['actions']}\n"
            f"Success rate: {int(PF['success_rate']*100)}%\n"
            f"Uptime: {uptime_str()}"
        )

    elif any(w in t for w in ("grow", "scale", "expand")):
        running = sum(1 for s in PF["agents"].values() if s == "running")
        reply = (
            f"Growth directive received.\n"
            f"{running} agents active at autonomy Level {PF['autonomy_level']}.\n"
            "Options:\n"
            "  grow agents     — activate idle agents\n"
            "  grow finance    — run capital allocation\n"
            "  grow autonomy   — raise autonomy level\n"
            "  grow evolution  — run CASCADE evolution\n"
            "What would you like to prioritise?"
        )

    elif "grow agents" in t or "start all" in t or "start agents" in t:
        started = []
        for k, v in PF["agents"].items():
            if v == "idle":
                PF["agents"][k] = "running"
                started.append(k)
        PF["actions"] += len(started)
        reply = (f"Started {len(started)} agents: {', '.join(started) or 'none were idle'}.\n"
                 f"All 15 agents now running." if started else "All agents already running.")

    elif "grow finance" in t or "finance round" in t or "capital" in t:
        PF["capital"] += 10000
        PF["actions"] += 5
        reply = (
            f"Financial round initiated.\n"
            f"Capital deployed: ${PF['capital']:,}\n"
            "FinanceAI agent is allocating across ops, marketing, and infrastructure."
        )

    elif "grow autonomy" in t or ("autonomy" in t and ("raise" in t or "up" in t or "increase" in t)):
        if PF["autonomy_level"] < 4:
            PF["autonomy_level"] += 1
        reply = (
            f"Autonomy raised to Level {PF['autonomy_level']}: "
            f"{AUTONOMY_NAMES[PF['autonomy_level']]}.\n"
        )
        if PF["autonomy_level"] >= 3:
            reply += "WARNING: Agents can now act without per-action confirmation."

    elif "grow evolution" in t or "evolution" in t:
        PF["actions"] += 20
        reply = "CASCADE evolution protocol initiated. Agent policies optimising across all 15 nodes..."

    elif "agent" in t:
        running = [k for k, v in PF["agents"].items() if v == "running"]
        idle    = [k for k, v in PF["agents"].items() if v == "idle"]
        reply = (
            f"ProtoForge Agent Mesh — 15 agents total\n"
            f"Running ({len(running)}): {', '.join(running)}\n"
            f"Idle ({len(idle)}):    {', '.join(idle) or 'none'}\n"
            f"Autonomy: Level {PF['autonomy_level']}"
        )

    elif any(w in t for w in ("financ", "revenue", "money", "capital")):
        reply = (
            f"Financial Engine Status:\n"
            f"Capital deployed: ${PF['capital']:,}\n"
            f"Agent actions:    {PF['actions']}\n"
            f"Success rate:     {int(PF['success_rate']*100)}%\n"
            f"Trust score:      {int(PF['trust_score']*100)}%"
        )

    elif any(w in t for w in ("approval", "queue", "pending")):
        if PF["approvals"]:
            reply = f"{len(PF['approvals'])} approvals pending:\n"
            for i, a in enumerate(PF["approvals"]):
                reply += f"  [{i}] {a.get('title','Action')} — {a.get('agent','')}\n"
            reply += "Type 'approve 0' or 'reject 0' to act."
        else:
            reply = "No pending approvals. All agents operating within authorised parameters."

    elif t.startswith("approve ") or t.startswith("reject ") or t.startswith("defer "):
        parts = t.split()
        decision = parts[0]
        idx = int(parts[1]) if len(parts) > 1 and parts[1].isdigit() else -1
        if 0 <= idx < len(PF["approvals"]):
            item = PF["approvals"].pop(idx)
            reply = f"{decision.capitalize()}d: {item.get('title','request')}."
            log_event(f"{decision.capitalize()}d: {item.get('title','')}", "ok")
        else:
            reply = "Invalid approval index. Use 'approvals' to list pending items."

    elif "autonomy" in t:
        reply = (
            f"Current autonomy: Level {PF['autonomy_level']} — {AUTONOMY_NAMES[PF['autonomy_level']]}\n"
            "Levels: 0=Observe 1=Assist 2=Approve 3=Conditional 4=Full\n"
            "Type 'set autonomy 3' to change level."
        )

    elif t.startswith("set autonomy"):
        parts = t.split()
        try:
            lvl = int(parts[-1])
            assert 0 <= lvl <= 4
            PF["autonomy_level"] = lvl
            reply = f"Autonomy set to Level {lvl}: {AUTONOMY_NAMES[lvl]}."
            log_event(f"Autonomy → Level {lvl}", "warn" if lvl >= 3 else "ok")
        except Exception:
            reply = "Usage: set autonomy <0-4>"

    elif t.startswith("start "):
        name = t[6:].strip()
        if name in PF["agents"]:
            PF["agents"][name] = "running"
            reply = f"Agent '{name}' started."
        else:
            reply = f"Unknown agent: {name}. Try 'agents' for the full list."

    elif t.startswith("stop ") or t.startswith("pause "):
        name = t.split(" ", 1)[1].strip()
        if name in PF["agents"]:
            PF["agents"][name] = "paused"
            reply = f"Agent '{name}' paused."
        else:
            reply = f"Unknown agent: {name}."

    elif any(w in t for w in ("prime directive", "mission", "purpose")):
        reply = (
            "Prime Directive: Build, fund, operate, and grow ProtoForge as a\n"
            "self-sustaining autonomous system — with human oversight at every\n"
            f"critical decision point.\n"
            f"Current level: {PF['autonomy_level']} ({AUTONOMY_NAMES[PF['autonomy_level']]})"
        )

    elif any(w in t for w in ("cascade", "event bus")):
        status = PF["agents"].get("cascade", "unknown")
        reply = (
            f"CASCADE event bus: {status.upper()}\n"
            "Pipeline: INTAKE → VALIDATION → CLASSIFICATION → EMISSION\n"
            "All events deterministically logged with integrity fingerprints."
        )

    elif any(w in t for w in ("help", "commands", "what can")):
        reply = HELP_TEXT

    elif t in ("hi", "hello", "hey", "yo"):
        reply = (
            "Hey! Hydi online — ProtoForge Command ready.\n"
            "Type 'status' for a system overview, 'grow' to scale,\n"
            "or 'help' for all commands."
        )

    else:
        running = sum(1 for s in PF["agents"].values() if s == "running")
        reply = (
            f"Understood. Processing: \"{msg[:60]}{'...' if len(msg)>60 else ''}\"\n"
            f"{running} active agents ready to execute.\n"
            "Type 'help' for available commands."
        )

    log_event(f"Chat: {msg[:50]}", "info")
    return reply

HELP_TEXT = """\
Hydi ProtoForge Commands:
─────────────────────────
status / health     — system overview
agents              — list all agents & status
start <agent>       — activate an agent
stop <agent>        — pause an agent
start all           — activate all idle agents
grow                — show growth options
grow agents         — start all idle agents
grow finance        — run capital allocation
grow autonomy       — raise autonomy level by 1
grow evolution      — run CASCADE evolution
set autonomy <0-4>  — set autonomy level directly
autonomy            — show current level
approvals           — list pending approvals
approve <n>         — approve item n
reject <n>          — reject item n
finance / capital   — financial engine status
cascade             — event bus status
prime directive     — mission statement
help                — this list
exit / quit         — stop Hydi"""


# ── Utilities ─────────────────────────────────────────────
def uptime_str():
    secs = int(time.time() - PF["start_time"])
    h, rem = divmod(secs, 3600)
    m, s = divmod(rem, 60)
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

# ── HTTP Handler ─────────────────────────────────────────
class HydiHandler(BaseHTTPRequestHandler):

    def log_message(self, fmt, *args):
        pass  # suppress default access log

    def do_OPTIONS(self):
        self.send_response(200)
        self._cors()
        self.end_headers()

    def do_GET(self):
        parsed = urlparse(self.path)
        path = parsed.path.rstrip("/") or "/"

        if path in ("/", "/hydi", "/index"):
            self._serve_html()
        elif path == "/api/health":
            self._json(health_payload())
        elif path == "/api/protoforge/stats":
            PF["actions"] += 1
            self._json(stats_payload())
        elif path == "/api/protoforge/agents":
            self._json([{"id": k, "status": v} for k, v in PF["agents"].items()])
        elif path == "/api/protoforge/events":
            self._json(PF["events"][:20])
        elif path == "/manifest.json":
            self._json_raw(MANIFEST_JSON, content_type="application/manifest+json")
        elif path == "/sw.js":
            self._text(SW_JS, content_type="application/javascript")
        else:
            self.send_response(404)
            self.end_headers()

    def do_POST(self):
        length = int(self.headers.get("Content-Length", 0))
        body = json.loads(self.rfile.read(length) or b"{}")
        parsed = urlparse(self.path)
        path = parsed.path

        if path == "/api/chat":
            msg = body.get("message", "")
            reply = hydi_reply(msg)
            self._json({"response": reply, "system": "hydi"})

        elif path == "/api/protoforge/autonomy":
            lvl = int(body.get("level", PF["autonomy_level"]))
            if 0 <= lvl <= 4:
                PF["autonomy_level"] = lvl
                log_event(f"Autonomy → Level {lvl}", "warn" if lvl >= 3 else "ok")
            self._json({"autonomy_level": PF["autonomy_level"]})

        elif path.startswith("/api/protoforge/agents/"):
            parts = path.split("/")
            agent_id = parts[4] if len(parts) > 4 else ""
            cmd      = parts[5] if len(parts) > 5 else ""
            status_map = {"start": "running", "pause": "paused", "restart": "running", "stop": "idle"}
            if agent_id in PF["agents"] and cmd in status_map:
                PF["agents"][agent_id] = status_map[cmd]
                log_event(f"Agent {agent_id} → {cmd}", "ok")
            self._json({"agentId": agent_id, "status": PF["agents"].get(agent_id, "unknown")})

        elif path == "/api/protoforge/grow":
            action = body.get("action", "")
            PF["actions"] += 10
            log_event(f"Grow: {action}", "ok")
            self._json({"queued": action})

        elif path == "/api/protoforge/approval":
            approval_id = body.get("approvalId", "")
            decision    = body.get("decision", "")
            PF["approvals"] = [a for a in PF["approvals"] if a.get("id") != approval_id]
            log_event(f"Approval {decision}: {approval_id}", "ok" if decision == "approve" else "warn")
            self._json({"approvalId": approval_id, "decision": decision})

        else:
            self.send_response(404)
            self.end_headers()

    # ── send helpers ──
    def _cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")

    def _json(self, obj):
        self._json_raw(json.dumps(obj))

    def _json_raw(self, raw, content_type="application/json"):
        data = raw.encode() if isinstance(raw, str) else raw
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", len(data))
        self._cors()
        self.end_headers()
        self.wfile.write(data)

    def _text(self, raw, content_type="text/plain"):
        self._json_raw(raw, content_type=content_type)

    def _serve_html(self):
        html_bytes = build_html().encode()
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", len(html_bytes))
        self._cors()
        self.end_headers()
        self.wfile.write(html_bytes)


# ── Payload builders ─────────────────────────────────────
def health_payload():
    return {
        "current_status": "OK",
        "jobs_queued": len(PF["approvals"]),
        "trend_status": "STABLE",
        "auto_heals_24h": 3,
        "last_check": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }

def stats_payload():
    return {
        "capital_deployed": PF["capital"],
        "agent_actions": PF["actions"],
        "success_rate": PF["success_rate"],
        "trust_score": PF["trust_score"],
        "autonomy_level": PF["autonomy_level"],
        "agents_running": sum(1 for s in PF["agents"].values() if s == "running"),
        "agents_total": len(PF["agents"]),
        "approvals_pending": len(PF["approvals"]),
        "uptime": uptime_str(),
    }


# ── Embedded PWA HTML ────────────────────────────────────
def build_html():
    """Return the full mobile PWA as an HTML string (no external files needed)."""
    # Read from file if available, else embed minimal version
    here = os.path.dirname(os.path.abspath(__file__))
    html_path = os.path.join(here, "hydi-mobile-protoforge.html")
    if os.path.exists(html_path):
        with open(html_path, encoding="utf-8") as f:
            return f.read()
    # Minimal fallback (works offline)
    return FALLBACK_HTML


FALLBACK_HTML = """\
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no,viewport-fit=cover">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="theme-color" content="#0a0a0f">
<title>Hydi — ProtoForge</title>
<style>
*{box-sizing:border-box;margin:0;padding:0;-webkit-tap-highlight-color:transparent}
:root{--bg0:#08080e;--bg1:#0f0f18;--bg2:#161622;--accent:#64ffda;--txt0:#e2e8f0;--txt1:#94a3b8;--txt2:#64748b;--ok:#10b981;--tab-h:56px}
html,body{height:100%;background:var(--bg0);color:var(--txt0);font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif}
#app{display:flex;flex-direction:column;height:100dvh;height:100vh}
.hdr{height:56px;background:var(--bg1);border-bottom:1px solid rgba(255,255,255,.06);display:flex;align-items:center;padding:0 14px;gap:10px;flex-shrink:0}
.orb{width:34px;height:34px;border-radius:50%;background:conic-gradient(from 180deg,#64ffda,#7c6aff,#ff6ac1,#64ffda);display:flex;align-items:center;justify-content:center;font-size:16px;animation:spin 8s linear infinite;flex-shrink:0}
@keyframes spin{to{filter:hue-rotate(360deg)}}
.brand{font-size:16px;font-weight:700}
.sub{font-size:11px;color:var(--txt2)}
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
.send:active{transform:scale(.93)}
.send:disabled{opacity:.4}
.send svg{width:17px;height:17px;fill:#000}
.dot{width:6px;height:6px;border-radius:50%;background:var(--ok);animation:blink 2s infinite;flex-shrink:0}
@keyframes blink{0%,100%{opacity:1}50%{opacity:.4}}
.typing{align-self:flex-start}.tdots{background:#1e1e2e;border:1px solid rgba(255,255,255,.08);border-bottom-left-radius:4px;border-radius:18px;padding:11px 16px;display:flex;gap:5px}
.tdots span{width:7px;height:7px;border-radius:50%;background:var(--txt2);animation:td 1.2s infinite}
.tdots span:nth-child(2){animation-delay:.2s}.tdots span:nth-child(3){animation-delay:.4s}
@keyframes td{0%,80%,100%{transform:scale(.7);opacity:.5}40%{transform:scale(1);opacity:1}}
</style>
</head>
<body>
<div id="app">
  <div class="hdr">
    <div class="orb">🧠</div>
    <div><div class="brand">Hydi</div><div class="sub">ProtoForge Command</div></div>
    <div class="dot" style="margin-left:auto" id="dot"></div>
    <span id="conn" style="font-size:11px;color:var(--txt2)">Online</span>
  </div>
  <div class="msgs" id="msgs">
    <div class="msg s"><div class="bbl">🧠 Hydi online. How can I help you grow ProtoForge today?</div></div>
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
      <button class="send" id="sb" onclick="send()">
        <svg viewBox="0 0 24 24"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>
      </button>
    </div>
  </div>
</div>
<script>
function esc(s){const d=document.createElement('div');d.textContent=s;return d.innerHTML}
function ts(){return new Date().toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})}
function add(cls,txt){
  const b=document.getElementById('msgs');
  const d=document.createElement('div');
  d.className='msg '+cls;
  d.innerHTML='<div class="bbl">'+esc(txt)+'</div><div class="mt">'+(cls==='u'?'You':'Hydi')+' · '+ts()+'</div>';
  b.appendChild(d);b.scrollTop=b.scrollHeight;
}
function showTyping(){
  const b=document.getElementById('msgs');
  if(document.getElementById('ty'))return;
  const d=document.createElement('div');
  d.className='msg typing';d.id='ty';
  d.innerHTML='<div class="tdots"><span></span><span></span><span></span></div>';
  b.appendChild(d);b.scrollTop=b.scrollHeight;
}
function hideTyping(){document.getElementById('ty')?.remove()}
async function send(){
  const ti=document.getElementById('ti');
  const msg=ti.value.trim();if(!msg)return;
  add('u',msg);ti.value='';ar(ti);showTyping();
  try{
    const r=await fetch('/api/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({message:msg})});
    const d=await r.json();hideTyping();add('h',d.response||'...');
  }catch{hideTyping();add('h','Connection error. Is the server running?');}
}
function sc(t){document.getElementById('ti').value=t;send()}
function ar(el){el.style.height='auto';el.style.height=Math.min(el.scrollHeight,100)+'px'}
function kd(e){if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();send()}}
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
    "icons": [
        {"src": "/icon-192.png", "sizes": "192x192", "type": "image/png", "purpose": "any maskable"}
    ]
})

SW_JS = """\
const C='hydi-v1';
self.addEventListener('install',e=>{e.waitUntil(caches.open(C).then(c=>c.addAll(['/','/manifest.json'])).then(()=>self.skipWaiting()))});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k!==C).map(k=>caches.delete(k)))).then(()=>self.clients.claim()))});
self.addEventListener('fetch',e=>{if(e.request.url.includes('/api/'))return;e.respondWith(caches.match(e.request).then(r=>r||fetch(e.request).then(res=>{if(res.ok){const cl=res.clone();caches.open(C).then(c=>c.put(e.request,cl))}return res}).catch(()=>caches.match('/'))))});
"""

# ── CLI mode ─────────────────────────────────────────────
BANNER = r"""
  _   _  _   _  ____  ___
 | | | || | | ||  _ \|_ _|
 | |_| || |_| || | | || |
 |  _  ||  _  || |_| || |
 |_| |_||_| |_||____/|___|
 ProtoForge Command  v2.0
"""

def cli_loop():
    print(BANNER)
    print("Type 'help' for commands, 'exit' to quit.\n")
    while True:
        try:
            msg = input("hydi> ").strip()
        except (EOFError, KeyboardInterrupt):
            print("\nBye.")
            break

        if not msg:
            continue
        if msg.lower() in ("exit", "quit", "bye", "/bye"):
            print("Shutting down Hydi. Goodbye.")
            break

        reply = hydi_reply(msg)
        print(f"\n{reply}\n")
        speak_async(reply)


# ── Server mode ──────────────────────────────────────────
def start_server(port=3006, host="0.0.0.0"):
    from http.server import ThreadingHTTPServer

    server = ThreadingHTTPServer((host, port), HydiHandler)
    ip = local_ip()

    print(BANNER)
    print(f"  📱  Mobile PWA:    http://{ip}:{port}/")
    print(f"  💻  Local:         http://localhost:{port}/")
    print(f"  📡  API health:    http://localhost:{port}/api/health")
    print(f"  🤖  Agents API:    http://localhost:{port}/api/protoforge/agents")
    print(f"  📊  Stats API:     http://localhost:{port}/api/protoforge/stats")
    print(f"\n  Open the URL above in your mobile browser.")
    print(f"  Tap ⋮ Share → 'Add to Home Screen' to install.\n")
    print("  Ctrl+C to stop.\n")

    # Add a demo approval after 5s
    def _demo():
        time.sleep(5)
        PF["approvals"].append({
            "id": "demo-001",
            "agent": "FinanceAI",
            "title": "Initial Capital Allocation",
            "description": "Deploy $50,000 seed capital across ops, marketing, infrastructure.",
            "priority": "high",
            "meta": ["$50,000", "seed-round"],
        })
        log_event("Approval pending: Initial Capital Allocation", "warn")
    threading.Thread(target=_demo, daemon=True).start()

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nShutting down Hydi server.")
        server.shutdown()


# ── Entry point ──────────────────────────────────────────
def main():
    args = sys.argv[1:]

    if not args:
        # Default: start server
        port = int(os.environ.get("HYDI_PORT", 3006))
        start_server(port=port)

    elif args[0] == "cli":
        cli_loop()

    elif args[0] == "server":
        port = int(args[1]) if len(args) > 1 else 3006
        start_server(port=port)

    else:
        # Treat remaining args as a direct command
        msg = " ".join(args)
        reply = hydi_reply(msg)
        print(reply)
        speak_async(reply)

if __name__ == "__main__":
    main()
