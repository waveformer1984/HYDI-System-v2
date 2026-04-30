// GLOBAL EXECUTION POLICY - NON-NEGOTIABLE
const EXECUTION_POLICY = {
  priority: ["cli", "api", "ui"],
  enforce: true,
  failIfNoCLI: false,
  logViolations: true
};

// PLATFORM CLI MAP - THE "DON'T THINK, JUST ACT" LAYER
const PLATFORM_CLI_MAP = {
  github: {
    cli: "gh",
    commands: {
      createRepo: "gh repo create",
      push: "git push",
      createPR: "gh pr create",
      issues: "gh issue"
    }
  },
  vercel: {
    cli: "vercel",
    commands: {
      deploy: "vercel deploy",
      env: "vercel env",
      logs: "vercel logs",
      link: "vercel link",
      alias: "vercel alias"
    }
  },
  supabase: {
    cli: "supabase",
    commands: {
      start: "supabase start",
      deploy: "supabase db push",
      functions: "supabase functions deploy",
      login: "supabase login"
    }
  },
  stripe: {
    cli: "stripe",
    commands: {
      login: "stripe login",
      listen: "stripe listen",
      webhooks: "stripe webhooks",
      createWebhook: "stripe post webhook_endpoints",
      testWebhook: "stripe trigger",
      get: "stripe get"
    }
  },
  npm: {
    cli: "npm",
    commands: {
      install: "npm install",
      publish: "npm publish",
      login: "npm login"
    }
  }
};

// HARD GATE - NO EXCEPTIONS
function enforceCLI(task) {
  const platform = detectPlatform(task);
  const cliCommand = resolveCLI(platform, task);

  if (cliCommand) {
    logDecision("CLI", cliCommand, platform);
    return runCLI(cliCommand);
  }

  if (EXECUTION_POLICY.enforce) {
    logDecision("CLI_MISS", task, platform);
    if (EXECUTION_POLICY.failIfNoCLI) {
      throw new Error(`CLI-first policy violation: No CLI command found for ${task}`);
    }
  }

  return fallbackExecution(task);
}

// INTENT RESOLVER - NO PHILOSOPHY MAJOR HESITATION
function resolveCLI(platform, intent) {
  const p = PLATFORM_CLI_MAP[platform];
  if (!p) return null;

  // Direct command mapping - crude but effective
  if (intent.includes("deploy")) return p.commands.deploy;
  if (intent.includes("push")) return p.commands.push;
  if (intent.includes("create repo")) return p.commands.createRepo;
  if (intent.includes("env")) return p.commands.env;
  if (intent.includes("webhook")) return p.commands.createWebhook;
  if (intent.includes("listen")) return p.commands.listen;
  if (intent.includes("trigger")) return p.commands.testWebhook;
  if (intent.includes("get")) return p.commands.get;
  if (intent.includes("login")) return p.commands.login;
  if (intent.includes("publish")) return p.commands.publish;

  return null;
}

// PLATFORM DETECTION
function detectPlatform(task) {
  if (task.includes("stripe") || task.includes("webhook")) return "stripe";
  if (task.includes("vercel") || task.includes("deploy")) return "vercel";
  if (task.includes("github") || task.includes("repo")) return "github";
  if (task.includes("supabase")) return "supabase";
  if (task.includes("npm")) return "npm";
  return null;
}

// LOGGING THAT EXPOSES BETRAYAL INSTANTLY
function logDecision(method, command, platform = null) {
  const logEntry = {
    timestamp: new Date().toISOString(),
    method,
    command,
    platform,
    policy: EXECUTION_POLICY.enforce ? "ENFORCED" : "SUGGESTED"
  };

  console.log(`[CASCADE_EXECUTION] method: ${method} | command: ${command} | platform: ${platform}`);
  
  if (method !== "CLI" && EXECUTION_POLICY.logViolations) {
    console.error(`[POLICY_VIOLATION] Expected CLI, got: ${method}`);
  }

  return logEntry;
}

// FALLBACK EXECUTION (LAST RESORT)
function fallbackExecution(task) {
  logDecision("FALLBACK", task);
  console.warn(`[FALLBACK] No CLI found for: ${task}`);
  return null;
}

// RUN CLI WRAPPER
async function runCLI(command) {
  try {
    console.log(`[CLI_EXEC] ${command}`);
    // This would execute the actual command
    return { success: true, command };
  } catch (error) {
    console.error(`[CLI_ERROR] ${command}:`, error);
    return { success: false, error, command };
  }
}

// TEST CASES - FORCE A FEW BREAKS
const TEST_CASES = [
  { input: "Deploy to Vercel", expectedMethod: "CLI", expectedCommand: "vercel deploy" },
  { input: "Create GitHub repo", expectedMethod: "CLI", expectedCommand: "gh repo create" },
  { input: "Do something vague with Supabase", expectedMethod: "CLI_MISS" }
];

function runTests() {
  console.log("\n=== POLICY COMPLIANCE TESTS ===");
  TEST_CASES.forEach((test, i) => {
    console.log(`\nTest ${i + 1}: "${test.input}"`);
    const result = enforceCLI(test.input);
    console.log(`Expected: ${test.expectedMethod} | Got: ${result ? "CLI" : "CLI_MISS"}`);
  });
}

module.exports = {
  EXECUTION_POLICY,
  PLATFORM_CLI_MAP,
  enforceCLI,
  resolveCLI,
  detectPlatform,
  runTests
};
