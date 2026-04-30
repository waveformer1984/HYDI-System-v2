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
      createWebhook: "stripe webhooks create",
      testWebhook: "stripe webhooks trigger"
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

function resolveCLI(platform, intent) {
  const p = PLATFORM_CLI_MAP[platform];
  if (!p) return null;

  // Direct command mapping
  if (intent.includes("deploy")) return p.commands.deploy;
  if (intent.includes("push")) return p.commands.push;
  if (intent.includes("create repo")) return p.commands.createRepo;
  if (intent.includes("env")) return p.commands.env;
  if (intent.includes("webhook")) return p.commands.createWebhook;
  if (intent.includes("listen")) return p.commands.listen;
  if (intent.includes("login")) return p.commands.login;
  if (intent.includes("publish")) return p.commands.publish;

  return null;
}

function detectPlatform(task) {
  if (task.includes("stripe") || task.includes("webhook")) return "stripe";
  if (task.includes("vercel") || task.includes("deploy")) return "vercel";
  if (task.includes("github") || task.includes("repo")) return "github";
  if (task.includes("supabase")) return "supabase";
  if (task.includes("npm")) return "npm";
  return null;
}

async function executeTask(task, params = {}) {
  const platform = detectPlatform(task);
  const cliCommand = resolveCLI(platform, task);

  if (!cliCommand) {
    console.log(`❌ No CLI command found for: ${task}`);
    return null;
  }

  console.log(`🚀 Executing: ${cliCommand} ${params.args || ''}`);
  
  try {
    // This would execute the actual CLI command
    // For now, return the command structure
    return {
      platform,
      command: cliCommand,
      params,
      confidence: 0.9
    };
  } catch (error) {
    console.error(`❌ Failed to execute: ${cliCommand}`, error);
    return null;
  }
}

module.exports = {
  PLATFORM_CLI_MAP,
  resolveCLI,
  detectPlatform,
  executeTask
};
