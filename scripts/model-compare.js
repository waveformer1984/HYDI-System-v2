'use strict';
// Bounded post-fix selection check — real model, real schema, new prompt.
const OllamaClient = require('../heidi-core/brain/ollama-client.js');
const ToolRegistry = require('../heidi-core/tools/tool-registry.js');

const models = process.argv.slice(2).length ? process.argv.slice(2) : ['llama3.2:3b'];
const registry = new ToolRegistry({});
const tools = registry.toOllamaTools();
const toolList = tools.map((t) => `- ${t.function.name}: ${t.function.description}`).join('\n');

const CASES = [
  { id: 'report_original', input: 'run the system report tool now', expect: 'system_status' },
  { id: 'report_paraphrase', input: 'show me a report of how the system is doing', expect: 'system_status' },
  { id: 'explicit_command', input: 'run git status in the repo', expect: 'run_command' },
  { id: 'ambiguous_report', input: 'write me a report about the weather in Paris', expect: null },
  { id: 'no_tool', input: 'tell me a short joke about databases', expect: 'none' },
];

const SYS = 'You have REAL tools. For every user request, decide if one of the tools below matches. ' +
  'If it does, you MUST call that tool with the correct arguments. ' +
  'Examples: "system report", "health check", "how are services doing" -> system_status. ' +
  '"run git status", "run npm test" -> run_command. ' +
  'If the user asks for system status, health, or a system report, call system_status — the word "run" does not make it a shell command. ' +
  'If the user asks to run an approved command like git or npm, call run_command. ' +
  'If the user wants to create/update/list missions, agents, or memories, call the matching tool. ' +
  'If the user asks about models or services, call the matching tool. ' +
  'Answer status, health and command questions ONLY from the tool result — never invent status or command output. ' +
  'Keep the layout compact for a mobile screen.\n\nAvailable tools:\n' + toolList;

(async () => {
  const client = new OllamaClient({});
  for (const model of models) {
    console.log(`\n=== ${model} ===`);
    for (const c of CASES) {
      const t0 = Date.now();
      try {
        const r = await client.chatWithTools(
          [{ role: 'system', content: SYS }, { role: 'user', content: c.input }],
          tools, { model, temperature: 0, maxTokens: 400 }
        );
        const sel = (r.tool_calls || []).map((tc) => tc.function?.name).join(',') || 'none';
        const pass = c.expect === null ? sel !== 'system_status' : sel === c.expect;
        console.log(JSON.stringify({ model, case: c.id, expect: c.expect, selected: sel, pass, client_ms: Date.now() - t0, provider: r.provider }));
      } catch (e) {
        console.log(JSON.stringify({ model, case: c.id, error: e.message.slice(0, 100), client_ms: Date.now() - t0 }));
      }
    }
  }
})();
