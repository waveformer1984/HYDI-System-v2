import { createServer, IncomingMessage, ServerResponse } from "node:http";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";
import { HydiOSSurveyEngine } from './hydi_survey_engine';
import { TotalRecalLedger } from './total_recal_ledger';
import { HydiOSWirelessFlash } from './hydios_wireless_flash';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const port = process.env.PORT ? Number(process.env.PORT) : 7042;

// Initialize HYDI components
const surveyEngine = new HydiOSSurveyEngine();
const ledger = new TotalRecalLedger();
const wirelessFlash = new HydiOSWirelessFlash();

function sendJson(res: ServerResponse, code: number, data: unknown) {
  res.writeHead(code, {
    "content-type": "application/json",
    "access-control-allow-origin": "*",
    "access-control-allow-headers": "content-type",
    "access-control-allow-methods": "GET,POST,OPTIONS",
  });
  res.end(JSON.stringify(data));
}

function notFound(res: ServerResponse) {
  sendJson(res, 404, { ok: false, error: "not_found" });
}

function parseBody(req: IncomingMessage): Promise<any> {
  return new Promise((resolveP, rejectP) => {
    let data = "";
    req.on("data", (chunk) => (data += chunk));
    req.on("end", () => {
      if (!data) return resolveP({});
      try {
        resolveP(JSON.parse(data));
      } catch (e) {
        rejectP(e);
      }
    });
    req.on("error", rejectP);
  });
}

function runPython(code: string): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolveP) => {
    const env = { ...process.env, PYTHONUNBUFFERED: "1", PYTHONPATH: resolve(__dirname, "../../") };
    const child = spawn("python", ["-c", code], { env });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d.toString()));
    child.stderr.on("data", (d) => (stderr += d.toString()));
    child.on("close", (code) => resolveP({ code: code ?? 0, stdout, stderr }));
  });
}

async function handle(req: IncomingMessage, res: ServerResponse) {
  if (req.method === "OPTIONS") return sendJson(res, 200, { ok: true });

  // Health check
  if (req.url === "/health") {
    return sendJson(res, 200, { 
      ok: true, 
      service: "enhanced-hydi-mcp",
      components: {
        survey_engine: true,
        ledger: true,
        wireless_flash: true
      }
    });
  }

  // Survey Engine Endpoints
  if (req.method === "POST" && req.url === "/api/survey/start") {
    try {
      const body = await parseBody(req);
      const survey = body.survey;
      const initial_mood = body.initial_mood;

      const session = await surveyEngine.startSurveySession(survey, initial_mood);
      
      // Log to ledger
      ledger.addEntry('survey_session_started', {
        session_id: session.id,
        survey_id: survey.id,
        mood: session.mood_profile.name
      }, session.id);

      return sendJson(res, 200, { ok: true, session });
    } catch (e: any) {
      return sendJson(res, 400, { ok: false, error: String(e) });
    }
  }

  if (req.method === "POST" && req.url === "/api/survey/checkpoint") {
    try {
      const body = await parseBody(req);
      const { session_id, checkpoint_id, response } = body;

      const survey_response = await surveyEngine.processCheckpoint(session_id, checkpoint_id, response);
      
      // Log to ledger
      ledger.addEntry('checkpoint_response', {
        session_id,
        checkpoint_id,
        response: survey_response.response,
        risk_detected: survey_response.risk_detected,
        mood_shift: survey_response.mood_shift
      }, session_id);

      return sendJson(res, 200, { ok: true, response: survey_response });
    } catch (e: any) {
      return sendJson(res, 400, { ok: false, error: String(e) });
    }
  }

  if (req.method === "POST" && req.url === "/api/survey/complete") {
    try {
      const body = await parseBody(req);
      const { session_id } = body;

      const result = await surveyEngine.completeSurvey(session_id);
      
      // Record earnings in ledger
      ledger.recordEarnings(
        session_id,
        'survey_completion',
        result.earnings,
        0, // performance bonus
        0, // risk penalty
        'CashApp_ProtoForge'
      );

      return sendJson(res, 200, { ok: true, result });
    } catch (e: any) {
      return sendJson(res, 400, { ok: false, error: String(e) });
    }
  }

  if (req.method === "GET" && req.url === "/api/survey/briefing") {
    try {
      const url = new URL(req.url!, `http://${req.headers.host}`);
      const survey_id = url.searchParams.get('survey_id');
      
      if (!survey_id) {
        return sendJson(res, 400, { ok: false, error: "survey_id required" });
      }

      const briefing = await surveyEngine.getSurveyBriefing(survey_id);
      return sendJson(res, 200, { ok: true, briefing });
    } catch (e: any) {
      return sendJson(res, 400, { ok: false, error: String(e) });
    }
  }

  // Mood Management Endpoints
  if (req.method === "POST" && req.url === "/api/mood/shift") {
    try {
      const body = await parseBody(req);
      const { session_id, new_mood } = body;

      const success = await surveyEngine.shiftMood(session_id, new_mood);
      
      if (success) {
        // Log mood shift to ledger
        ledger.addEntry('mood_shift_requested', {
          session_id,
          new_mood,
          timestamp: new Date().toISOString()
        }, session_id);
      }

      return sendJson(res, 200, { ok: true, success });
    } catch (e: any) {
      return sendJson(res, 400, { ok: false, error: String(e) });
    }
  }

  if (req.method === "GET" && req.url === "/api/mood/profiles") {
    try {
      const profiles = surveyEngine.getMoodProfiles();
      return sendJson(res, 200, { ok: true, profiles });
    } catch (e: any) {
      return sendJson(res, 400, { ok: false, error: String(e) });
    }
  }

  // Ledger Endpoints
  if (req.method === "GET" && req.url === "/api/ledger/summary") {
    try {
      const summary = ledger.getLedgerSummary();
      return sendJson(res, 200, { ok: true, summary });
    } catch (e: any) {
      return sendJson(res, 400, { ok: false, error: String(e) });
    }
  }

  if (req.method === "GET" && req.url === "/api/ledger/earnings") {
    try {
      const url = new URL(req.url!, `http://${req.headers.host}`);
      const session_id = url.searchParams.get('session_id');
      
      const earnings = ledger.getEarningsHistory(session_id || undefined);
      return sendJson(res, 200, { ok: true, earnings });
    } catch (e: any) {
      return sendJson(res, 400, { ok: false, error: String(e) });
    }
  }

  if (req.method === "GET" && req.url === "/api/ledger/risk") {
    try {
      const url = new URL(req.url!, `http://${req.headers.host}`);
      const session_id = url.searchParams.get('session_id');
      
      const risk = ledger.getRiskHistory(session_id || undefined);
      return sendJson(res, 200, { ok: true, risk });
    } catch (e: any) {
      return sendJson(res, 400, { ok: false, error: String(e) });
    }
  }

  // Wireless Flash Endpoints
  if (req.method === "POST" && req.url === "/api/watch/connect") {
    try {
      const body = await parseBody(req);
      const { watch_ip, watch_port } = body;

      if (watch_ip) wirelessFlash.updateWatchIP(watch_ip);
      if (watch_port) wirelessFlash.updateWatchPort(watch_port);

      const connected = await wirelessFlash.connectToWatch();
      return sendJson(res, 200, { ok: true, connected });
    } catch (e: any) {
      return sendJson(res, 400, { ok: false, error: String(e) });
    }
  }

  if (req.method === "GET" && req.url === "/api/watch/status") {
    try {
      const status = await wirelessFlash.getWatchStatus();
      return sendJson(res, 200, { ok: true, status });
    } catch (e: any) {
      return sendJson(res, 400, { ok: false, error: String(e) });
    }
  }

  if (req.method === "POST" && req.url === "/api/watch/flash") {
    try {
      const body = await parseBody(req);
      const { firmware_path } = body;

      if (firmware_path) {
        wirelessFlash.updateFirmware(firmware_path);
      }

      const success = await wirelessFlash.flashFirmware();
      return sendJson(res, 200, { ok: true, success });
    } catch (e: any) {
      return sendJson(res, 400, { ok: false, error: String(e) });
    }
  }

  if (req.method === "POST" && req.url === "/api/watch/launcher") {
    try {
      const success = await wirelessFlash.installLauncherFallback();
      return sendJson(res, 200, { ok: true, success });
    } catch (e: any) {
      return sendJson(res, 400, { ok: false, error: String(e) });
    }
  }

  if (req.method === "POST" && req.url === "/api/watch/burnin") {
    try {
      const body = await parseBody(req);
      const { duration_hours } = body;

      if (duration_hours) {
        wirelessFlash.setBurnInDuration(duration_hours);
      }

      const success = await wirelessFlash.startBurnIn();
      return sendJson(res, 200, { ok: true, success });
    } catch (e: any) {
      return sendJson(res, 400, { ok: false, error: String(e) });
    }
  }

  if (req.method === "GET" && req.url === "/api/watch/burnin") {
    try {
      const session = wirelessFlash.getBurnInSession();
      return sendJson(res, 200, { ok: true, session });
    } catch (e: any) {
      return sendJson(res, 400, { ok: false, error: String(e) });
    }
  }

  // Session Management Endpoints
  if (req.method === "GET" && req.url === "/api/sessions/active") {
    try {
      const sessions = surveyEngine.getActiveSessions();
      return sendJson(res, 200, { ok: true, sessions });
    } catch (e: any) {
      return sendJson(res, 400, { ok: false, error: String(e) });
    }
  }

  if (req.method === "GET" && req.url === "/api/sessions/history") {
    try {
      const url = new URL(req.url!, `http://${req.headers.host}`);
      const session_id = url.searchParams.get('session_id');
      
      if (!session_id) {
        return sendJson(res, 400, { ok: false, error: "session_id required" });
      }

      const history = ledger.getSessionHistory(session_id);
      return sendJson(res, 200, { ok: true, history });
    } catch (e: any) {
      return sendJson(res, 400, { ok: false, error: String(e) });
    }
  }

  // Knowledge Base Endpoints
  if (req.method === "POST" && req.url === "/api/knowledge/update") {
    try {
      const body = await parseBody(req);
      const { topic, content } = body;

      await surveyEngine.updateKnowledgeBase(topic, content);
      
      // Log to ledger
      ledger.addEntry('knowledge_updated', {
        topic,
        content_length: JSON.stringify(content).length,
        timestamp: new Date().toISOString()
      });

      return sendJson(res, 200, { ok: true, message: "Knowledge updated" });
    } catch (e: any) {
      return sendJson(res, 400, { ok: false, error: String(e) });
    }
  }

  // Risk Assessment Endpoints
  if (req.method === "POST" && req.url === "/api/risk/assess") {
    try {
      const body = await parseBody(req);
      const { session_id, overall_risk, typing_pattern_risk, response_consistency_risk, mood_stability_risk, detection_probability, mitigation_strategies, triggered_alerts } = body;

      const assessment_id = ledger.recordRiskAssessment(
        session_id,
        overall_risk,
        typing_pattern_risk,
        response_consistency_risk,
        mood_stability_risk,
        detection_probability,
        mitigation_strategies,
        triggered_alerts
      );

      return sendJson(res, 200, { ok: true, assessment_id });
    } catch (e: any) {
      return sendJson(res, 400, { ok: false, error: String(e) });
    }
  }

  // Rollback Endpoints
  if (req.method === "POST" && req.url === "/api/rollback/persona") {
    try {
      const body = await parseBody(req);
      const { persona_id, target_timestamp } = body;

      const success = ledger.rollbackToPersona(persona_id, target_timestamp);
      return sendJson(res, 200, { ok: true, success });
    } catch (e: any) {
      return sendJson(res, 400, { ok: false, error: String(e) });
    }
  }

  if (req.method === "POST" && req.url === "/api/rollback/session") {
    try {
      const body = await parseBody(req);
      const { session_id, target_timestamp } = body;

      const success = ledger.rollbackToSession(session_id, target_timestamp);
      return sendJson(res, 200, { ok: true, success });
    } catch (e: any) {
      return sendJson(res, 400, { ok: false, error: String(e) });
    }
  }

  // Legacy HYDI Endpoints (maintained for compatibility)
  if (req.method === "POST" && req.url === "/api/cad/run") {
    try {
      const body = await parseBody(req);
      const task = body?.task ?? {};
      const dry = body?.dry_run !== false;
      
      const py = `import json\nfrom CADOps.CAD_Manager import CADManager, CADTask\n\nT=${JSON.stringify(task)}\n\nmgr=CADManager(dry_run=${dry ? "True" : "False"})\nres=mgr.run(CADTask(**T))\nprint(json.dumps(res))\n`;
      const out = await runPython(py);
      
      if (out.code !== 0) return sendJson(res, 500, { ok: false, stderr: out.stderr });
      
      try { 
        return sendJson(res, 200, JSON.parse(out.stdout || "{}")); 
      } catch {
        return sendJson(res, 200, { ok: true, stdout: out.stdout });
      }
    } catch (e: any) {
      return sendJson(res, 400, { ok: false, error: String(e) });
    }
  }

  if (req.method === "POST" && req.url === "/api/map/run") {
    try {
      const body = await parseBody(req);
      const job = body?.job ?? {};
      const dry = body?.dry_run !== false;
      
      const py = `import json\nfrom MapOps.Mapping_Manager import MappingManager, MapJob\n\nJ=${JSON.stringify(job)}\n\nmgr=MappingManager(dry_run=${dry ? "True" : "False"})\nres=mgr.run(MapJob(**J))\nprint(json.dumps(res))\n`;
      const out = await runPython(py);
      
      if (out.code !== 0) return sendJson(res, 500, { ok: false, stderr: out.stderr });
      
      try { 
        return sendJson(res, 200, JSON.parse(out.stdout || "{}")); 
      } catch {
        return sendJson(res, 200, { ok: true, stdout: out.stdout });
      }
    } catch (e: any) {
      return sendJson(res, 400, { ok: false, error: String(e) });
    }
  }

  if (req.method === "POST" && req.url === "/api/drone/command") {
    try {
      const body = await parseBody(req);
      const unit_id = body?.unit_id;
      const command = body?.command;
      const args = body?.args || {};
      
      const py = `import json\nfrom DroneOps.Drone_Manager import DroneManager\n\nmgr=DroneManager()\nres=mgr.execute_command("${unit_id}", "${command}", ${JSON.stringify(args)})\nprint(json.dumps(res))\n`;
      const out = await runPython(py);
      
      if (out.code !== 0) return sendJson(res, 500, { ok: false, stderr: out.stderr });
      
      try { 
        return sendJson(res, 200, JSON.parse(out.stdout || "{}")); 
      } catch {
        return sendJson(res, 200, { ok: true, stdout: out.stdout });
      }
    } catch (e: any) {
      return sendJson(res, 400, { ok: false, error: String(e) });
    }
  }

  // ---------------------------------------------------------------- Agent Loop
  if (req.method === "POST" && req.url === "/api/agent/run") {
    try {
      const body = await parseBody(req);
      const { goal, max_iterations } = body;

      if (!goal || typeof goal !== "string" || !goal.trim()) {
        return sendJson(res, 400, { ok: false, error: "goal is required" });
      }
      if (goal.length > 2000) {
        return sendJson(res, 400, { ok: false, error: "goal must be under 2000 characters" });
      }

      const safeIter = Math.min(20, Math.max(1, Number(max_iterations) || 10));
      const scriptPath = join(__dirname, "../../HYDI_Core/HydiCognitiveLoop.py");

      const result = await new Promise<object>((resolveP) => {
        const proc = spawn(
          "python",
          [scriptPath, "--goal", goal, "--max-iterations", String(safeIter)],
          {
            env: { ...process.env },
            // No shell — goal is passed as a direct argv element, safe from injection
          }
        );

        let stdout = "";
        let stderr = "";
        proc.stdout.on("data", (d: Buffer) => (stdout += d.toString()));
        proc.stderr.on("data", (d: Buffer) => (stderr += d.toString()));

        const timer = setTimeout(() => {
          proc.kill();
          resolveP({ ok: false, error: "Agent loop timed out after 5 minutes" });
        }, 300_000);

        proc.on("close", (code) => {
          clearTimeout(timer);
          // The loop prints logs then a final JSON object — parse the last {...}
          const match = stdout.match(/(\{[\s\S]*\})\s*$/);
          if (!match) {
            resolveP({ ok: false, error: "No JSON result from agent", stderr: stderr.slice(-500) });
            return;
          }
          try {
            resolveP({ ok: true, ...JSON.parse(match[1]) });
          } catch {
            resolveP({ ok: false, error: "Failed to parse agent result", raw: stdout.slice(-500) });
          }
        });

        proc.on("error", (err) => {
          clearTimeout(timer);
          resolveP({ ok: false, error: err.message });
        });
      });

      // Log the agent run to the ledger
      ledger.addEntry("agent_loop_run", {
        goal: (body.goal as string).slice(0, 120),
        timestamp: new Date().toISOString(),
      });

      return sendJson(res, 200, result);
    } catch (e: any) {
      return sendJson(res, 400, { ok: false, error: String(e) });
    }
  }

  // Not found
  return notFound(res);
}

// Create and start server
const server = createServer(handle);

server.listen(port, () => {
  console.log(`🚀 Enhanced HYDI MCP Server running on port ${port}`);
  console.log(`📊 Survey Engine: Ready`);
  console.log(`📋 TOTAL RE⚙️CAL Ledger: Ready`);
  console.log(`⌚ HydiOS Wireless Flash: Ready`);
  console.log(`🔗 Legacy HYDI endpoints: Available`);
  console.log(`\n📖 Available endpoints:`);
  console.log(`   POST /api/survey/start - Start survey session`);
  console.log(`   POST /api/survey/checkpoint - Process checkpoint response`);
  console.log(`   POST /api/survey/complete - Complete survey session`);
  console.log(`   GET  /api/survey/briefing - Get survey briefing`);
  console.log(`   POST /api/mood/shift - Shift mood profile`);
  console.log(`   GET  /api/mood/profiles - Get available mood profiles`);
  console.log(`   GET  /api/ledger/summary - Get ledger summary`);
  console.log(`   GET  /api/ledger/earnings - Get earnings history`);
  console.log(`   GET  /api/ledger/risk - Get risk assessment history`);
  console.log(`   POST /api/watch/connect - Connect to smartwatch`);
  console.log(`   GET  /api/watch/status - Get watch status`);
  console.log(`   POST /api/watch/flash - Flash HydiOS firmware`);
  console.log(`   POST /api/watch/launcher - Install launcher fallback`);
  console.log(`   POST /api/watch/burnin - Start burn-in process`);
  console.log(`   GET  /api/watch/burnin - Get burn-in status`);
  console.log(`   GET  /api/sessions/active - Get active sessions`);
  console.log(`   GET  /api/sessions/history - Get session history`);
  console.log(`   POST /api/knowledge/update - Update knowledge base`);
  console.log(`   POST /api/risk/assess - Record risk assessment`);
  console.log(`   POST /api/rollback/persona - Rollback persona state`);
  console.log(`   POST /api/rollback/session - Rollback session state`);
  console.log(`\n🧠 Cognitive Agent:`);
  console.log(`   POST /api/agent/run - Run Hydi autonomous reasoning loop`);
  console.log(`        body: { goal: string, max_iterations?: number (1-20) }`);
  console.log(`\n🔧 Legacy endpoints:`);
  console.log(`   POST /api/cad/run - Run CAD operations`);
  console.log(`   POST /api/map/run - Run mapping operations`);
  console.log(`   POST /api/drone/command - Execute drone commands`);
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n🛑 Shutting down Enhanced HYDI MCP Server...');
  server.close(() => {
    console.log('✅ Server closed');
    process.exit(0);
  });
});

process.on('SIGTERM', () => {
  console.log('\n🛑 Received SIGTERM, shutting down gracefully...');
  server.close(() => {
    console.log('✅ Server closed');
    process.exit(0);
  });
});
