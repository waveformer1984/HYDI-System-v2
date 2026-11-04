'use strict';
const OllamaClient = require('../heidi-core/brain/ollama-client.js');
const ToolRegistry = require('../heidi-core/tools/tool-registry.js');
const tools = new ToolRegistry({}).toOllamaTools();
const reordered = [...tools.filter((t) => t.function.name !== 'system_status'), tools.find((t) => t.function.name === 'system_status')];
const list = reordered.map((t) => '- ' + t.function.name + ': ' + t.function.description).join('\n');
const SYS = 'You have REAL tools. For every user request, decide if one of the tools below matches. If it does, you MUST call that tool with the correct arguments. Examples: "system report", "health check" -> system_status. "run git status" -> run_command. If the user asks for system status, health, or a system report, call system_status — the word "run" does not make it a shell command. If the user asks to run an approved command like git or npm, call run_command. Keep the layout compact for a mobile screen.\n\nAvailable tools:\n' + list;
(async () => {
  const c = new OllamaClient({});
  for (const input of ['run the system report tool now', 'show me a report of how the system is doing', 'run git status in the repo']) {
    const t0 = Date.now();
    try {
      const r = await c.chatWithTools([{ role: 'system', content: SYS }, { role: 'user', content: input }], reordered, { model: 'llama3.2:3b', temperature: 0, maxTokens: 400 });
      console.log(JSON.stringify({ input, selected: (r.tool_calls || []).map((t) => t.function?.name).join(',') || 'none', ms: Date.now() - t0 }));
    } catch (e) { console.log(JSON.stringify({ input, err: e.message.slice(0, 60) })); }
  }
})();
