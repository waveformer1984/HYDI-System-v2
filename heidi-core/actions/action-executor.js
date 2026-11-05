/**
 * HEIDI Action Executor
 * Where Heidi stops talking and starts doing
 * WITH SAFETY LAYER - because chaos is not a feature
 */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

/** Best-effort descendant enumeration (Linux /proc). Used only on non-win32 tree cleanup. */
function posixChildPids(parentPid) {
  const out = [];
  try {
    const raw = fs.readFileSync(`/proc/${parentPid}/task/${parentPid}/children`, 'utf8').trim();
    for (const part of raw.split(/\s+/)) {
      const n = Number(part);
      if (Number.isInteger(n) && n > 0) out.push(n);
    }
  } catch {
    /* process gone or /proc unavailable */
  }
  return out;
}

function killPosixTree(rootPid) {
  const tree = new Set();
  const collect = (pid) => {
    if (!pid || tree.has(pid)) return;
    tree.add(pid);
    for (const child of posixChildPids(pid)) collect(child);
  };
  collect(rootPid);
  for (const pid of [...tree].sort((a, b) => b - a)) {
    try {
      process.kill(-pid, 'SIGKILL');
    } catch {
      try {
        process.kill(pid, 'SIGKILL');
      } catch {
        /* already dead */
      }
    }
  }
  return tree;
}

class ActionExecutor {
  constructor(config = {}) {
    // Approved action types - everything else gets rejected
    this.approvedActions = new Set([
      'run_script',
      'run_command',
      'write_file',
      'read_file',
      'api_call',
      'log_event'
    ]);

    // Approved script directories
    this.approvedScriptDirs = config.approvedScriptDirs || [
      path.join(__dirname, '../../scripts'),
      path.join(__dirname, '../scripts'),
      path.join(__dirname, '../../cleanup')
    ];

    // Approved commands (whitelist)
    this.approvedCommands = new Set([
      'node',
      'powershell',
      'pwsh',
      'git',
      'npm',
      'echo',
      'cat',
      'ls',
      'dir'
    ]);

    // Approved API domains
    this.approvedDomains = config.approvedDomains || [
      'localhost',
      '127.0.0.1'
    ];

    this.executionLog = [];
  }

  /**
   * Main execution entry point
   */
  async execute(action) {
    // Safety check #1: Is this action type approved?
    if (!this.approvedActions.has(action.type)) {
      throw new Error(`Action type '${action.type}' is not approved`);
    }

    // Safety check #2: Does it have required fields?
    if (!action.target && !action.command) {
      throw new Error('Action must have target or command');
    }

    console.log(`[HEIDI Action] Executing: ${action.type} -> ${action.target || action.command}`);

    const startTime = Date.now();
    let result;

    try {
      switch (action.type) {
        case 'run_script':
          result = await this.runScript(action.target, action.args);
          break;
        case 'run_command':
          result = await this.runCommand(action.command, action.args, { timeout_ms: action.timeout_ms });
          break;
        case 'write_file':
          result = await this.writeFile(action.target, action.content);
          break;
        case 'read_file':
          result = await this.readFile(action.target);
          break;
        case 'api_call':
          result = await this.apiCall(action.target, action.options);
          break;
        case 'log_event':
          result = await this.logEvent(action.target, action.payload);
          break;
        default:
          throw new Error(`Unknown action type: ${action.type}`);
      }

      const execution = {
        action,
        result: 'success',
        duration_ms: Date.now() - startTime,
        timestamp: new Date().toISOString()
      };

      this.executionLog.push(execution);
      
      return {
        success: true,
        result,
        execution
      };

    } catch (error) {
      const execution = {
        action,
        result: 'failed',
        error: error.message,
        duration_ms: Date.now() - startTime,
        timestamp: new Date().toISOString()
      };

      this.executionLog.push(execution);
      
      throw error;
    }
  }

  /**
   * Run a script file
   */
  async runScript(scriptPath, args = []) {
    // Resolve to absolute path
    const absolutePath = path.resolve(scriptPath);
    
    // Safety check: Is this in an approved directory?
    const isApproved = this.approvedScriptDirs.some(dir => {
      const resolvedDir = path.resolve(dir);
      return absolutePath.startsWith(resolvedDir);
    });

    if (!isApproved) {
      throw new Error(`Script path not approved: ${scriptPath}`);
    }

    // Safety check: Does file exist?
    if (!fs.existsSync(absolutePath)) {
      throw new Error(`Script not found: ${absolutePath}`);
    }

    const ext = path.extname(absolutePath).toLowerCase();
    let command, commandArgs;

    if (ext === '.js') {
      command = 'node';
      commandArgs = [absolutePath, ...args];
    } else if (ext === '.ps1') {
      command = 'powershell';
      commandArgs = ['-ExecutionPolicy', 'Bypass', '-File', absolutePath, ...args];
    } else if (ext === '.sh') {
      command = 'bash';
      commandArgs = [absolutePath, ...args];
    } else {
      throw new Error(`Unsupported script type: ${ext}`);
    }

    return this.spawnProcess(command, commandArgs, { cwd: path.dirname(absolutePath) });
  }

  // Argument patterns that turn a whitelisted binary into an arbitrary-code
  // execution primitive. If any arg matches, the command is refused.
  static DANGEROUS_ARG_PATTERNS = [
    /^-{1,2}(c|e|eval|command|encodedcommand|exec)$/i, // node -e, powershell -Command/-EncodedCommand, etc.
    /[;&|`$><]/,          // shell metacharacters / redirection / chaining
    /\$\(/,               // command substitution
    /\.\.[\/\\]/          // path traversal in an arg
  ];

  /**
   * Per-binary command table — default deny. Binary allowlisting alone is not
   * enough: `git -c core.sshCommand=...` or `npm exec` turn a safe binary into
   * an exec primitive. Each entry validates the FULL argv and builds the
   * allowed argv itself — a user string never reaches spawn unchecked.
   *
   * `runCommand(command, args)` calls `validators[cmd](args)` → argv | throws.
   */
  getApprovedRoots() {
    return (this.config || {}).approvedRoots || [path.resolve(__dirname, '../..')];
  }

  npmValidate(args) {
    const a = args.map(String);
    let prefix = null;
    const rest = [];
    for (let i = 0; i < a.length; i++) {
      if (a[i] === '--prefix') {
        if (!a[i + 1]) throw new Error('npm: --prefix requires a path');
        const resolved = path.resolve(a[++i]);
        const inRoot = this.getApprovedRoots().some((r) => resolved === r || resolved.startsWith(r + path.sep));
        if (!inRoot) throw new Error(`npm: --prefix path outside approved roots: ${a[i]}`);
        prefix = resolved;
      } else rest.push(a[i]);
    }
    const blockedFlags = /^--(userconfig|registry|globalconfig|ignore-scripts|script-shell|init-|location)/i;
    for (const f of rest) {
      if (blockedFlags.test(f)) throw new Error(`npm: flag not permitted: ${f}`);
      // --version/-v are allowed forms handled by the subcommand check below.
      if (f.startsWith('-') && f !== '--version' && f !== '-v') throw new Error(`npm: unknown flag: ${f}`);
    }
    const sub = rest[0];
    const out = prefix ? ['--prefix', prefix] : [];
    if (sub === '--version' || sub === '-v') {
      if (rest.length > 1) throw new Error('npm: --version takes no extra args');
      return [...out, '--version'];
    }
    if (sub === 'test') {
      if (rest.length > 1) throw new Error(`npm: 'test' takes no extra args (got ${rest.slice(1).join(' ')})`);
      return [...out, 'test'];
    }
    if (sub === 'run' || sub === 'run-script') {
      const script = rest[1];
      if (!script || rest.length > 2) throw new Error('npm: run requires exactly one script name');
      const pkgDir = prefix || this.getApprovedRoots()[0];
      const pkg = JSON.parse(fs.readFileSync(path.join(pkgDir, 'package.json'), 'utf8'));
      if (!pkg.scripts || !pkg.scripts[script]) throw new Error(`npm: script '${script}' not found in ${pkgDir}/package.json`);
      return [...out, 'run', script];
    }
    throw new Error(`npm: subcommand not permitted: ${sub || '(none)'} — only test / run <script> / --version`);
  }

  gitValidate(args) {
    const a = args.map(String);
    if (!a.length) throw new Error('git: subcommand required');
    // Read-only subcommands only — no state mutation through run_command.
    const allowed = new Set(['status', 'log', 'diff', 'rev-parse', 'show']);
    const sub = a[0].toLowerCase();
    if (!allowed.has(sub)) {
      throw new Error(`git: subcommand not permitted: ${sub} — read-only only (status/log/diff/rev-parse/show)`);
    }
    const blocked = /^(-c|--exec$|--upload-pack$|--receive-pack$|--config-env)/i;
    for (const f of a.slice(1)) {
      if (blocked.test(f)) throw new Error(`git: flag not permitted: ${f}`);
    }
    return [sub, ...a.slice(1)];
  }

  // Resolve a bare command name through PATH+PATHEXT; refuse .cmd/.bat —
  // a batch file interprets args through a shell layer we do not control.
  resolveOnPath(cmd) {
    const pathext = (process.env.PATHEXT || '.EXE;.CMD;.BAT;.COM').split(';');
    for (const dir of (process.env.PATH || '').split(path.delimiter)) {
      for (const ext of pathext) {
        const p = path.join(dir, cmd.toUpperCase().endsWith(ext) ? cmd : cmd + ext.toLowerCase());
        if (fs.existsSync(p)) return p;
      }
    }
    return null;
  }

  /**
   * Run a command directly. Hardened: the binary must be in the command table
   * AND its full argv validated — a bare allowlist is argument-injectable.
   */
  async runCommand(command, args = [], opts = {}) {
    // Only a bare binary name is allowed — no inline args baked into `command`.
    if (/\s/.test(command)) {
      throw new Error(`Command must be a bare executable name, got: '${command}'`);
    }
    const cmd = command.toLowerCase();
    const validators = {
      npm: () => this.npmValidate(args),
      git: () => this.gitValidate(args),
      cat: () => args.map(String),
      ls: () => args.map(String),
      dir: () => args.map(String),
      echo: () => null, // handled in-process below
    };
    if (!validators[cmd]) {
      throw new Error(`Command '${cmd}' is not in the command table`);
    }

    // Vet every argument.
    for (const a of args) {
      const s = String(a);
      if (ActionExecutor.DANGEROUS_ARG_PATTERNS.some(re => re.test(s))) {
        throw new Error(`Refused unsafe argument to '${cmd}': ${s}`);
      }
    }

    const argv = validators[cmd](); // validated argv built from the table

    // Windows: refuse if the resolved binary is a batch file — .cmd/.bat
    // routes args through cmd.exe, bypassing the table's guarantees.
    if (process.platform === 'win32' && cmd !== 'npm' && cmd !== 'echo') {
      const resolved = this.resolveOnPath(cmd);
      if (resolved && /\.(cmd|bat)$/i.test(resolved)) {
        throw new Error(`Refused: '${cmd}' resolves to a batch file (${resolved}) — args would route through cmd.exe`);
      }
    }

    // `echo` is a shell builtin — on Windows there is no echo binary, so
    // spawning it with shell:false would ENOENT. It is side-effect free, so
    // emulate it in-process rather than routing through a shell.
    if (cmd === 'echo') {
      return { stdout: args.map(String).join(' ') + '\n', stderr: '', exitCode: 0 };
    }

    // On Windows `npm` is a .cmd batch file — spawn() with shell:false cannot
    // resolve it (mission #3885: spawn npm ENOENT). Run the same npm CLI
    // through the Node binary directly instead: shell-free, no .cmd needed.
    // The launcher still enforces the allowlist on 'npm' itself — this only
    // changes HOW the approved command executes, never WHICH command runs.
    if (cmd === 'npm' && process.platform === 'win32') {
      const npmCli = path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js');
      if (!fs.existsSync(npmCli)) {
        throw new Error(`npm launch adapter: npm-cli.js not found at ${npmCli}`);
      }
      return this.spawnProcess(process.execPath, [npmCli, ...argv], opts);
    }

    return this.spawnProcess(command, argv, opts);
  }

  /**
   * Spawn a child process
   */
  spawnProcess(command, args, options = {}) {
    return new Promise((resolve, reject) => {
      // Bounded timeout — an action may carry timeout_ms up to 10 minutes.
      // spawn's own `timeout` only kills the DIRECT child; a grandchild
      // inheriting stdio keeps `close` from firing (mission #3942 ran ~18h).
      // Own the deadline: kill the process TREE, tear down the pipes, and
      // settle once — never wait indefinitely on inherited handles.
      const timeout = Math.min(Math.max(Number(options.timeout_ms) || 30000, 1000), 600000);
      const spawnOpts = {
        shell: false,   // never route through a shell — args stay literal
        env: { ...process.env, NODE_ENV: 'production' },
      };
      if (process.platform !== 'win32') {
        // Own process group so kill(-pid) reaches grandchildren (mobile-ops parity).
        spawnOpts.detached = true;
      }
      const child = spawn(command, args, spawnOpts);

      let stdout = '';
      let stderr = '';
      let settled = false;

      const finish = (fn) => {
        if (settled) return; // exactly one terminal outcome
        settled = true;
        clearTimeout(deadline);
        fn();
      };

      // Owned-tree kill: taskkill /T targets this process's descendants only —
      // never a broad image-name match. Report cleanup failure explicitly.
      const killTree = () => new Promise((res) => {
        if (process.platform === 'win32') {
          const killer = spawn('taskkill', ['/T', '/F', '/PID', String(child.pid)], { shell: false });
          killer.on('close', (code) => res({ ok: code === 0 || code === 128, code }));
          killer.on('error', () => res({ ok: false, code: null }));
        } else {
          const alive = (pid) => {
            try {
              process.kill(pid, 0);
              return true;
            } catch (e) {
              return e && e.code !== 'ESRCH';
            }
          };
          const tree = killPosixTree(child.pid);
          setTimeout(() => {
            const survivors = [...tree].filter((p) => alive(p));
            res({ ok: survivors.length === 0, code: null, survivors });
          }, 100);
        }
      });

      let deadlineFired = false;
      const deadline = setTimeout(async () => {
        deadlineFired = true; // set BEFORE the kill so a racing close() reports the deadline
        const k = await killTree();
        try { child.stdout.destroy(); child.stderr.destroy(); } catch { /* pipes may already be gone */ }
        let note;
        if (k.ok) {
          note = 'owned process tree killed';
        } else if (process.platform === 'win32') {
          note = `cleanup FAILED (taskkill ${k.code}) — surviving work NOT confirmed stopped`;
        } else {
          const pidNote = k.survivors && k.survivors.length ? ` (pid ${k.survivors.join(', ')})` : '';
          note = `cleanup FAILED — NOT confirmed stopped${pidNote}`;
        }
        finish(() => reject(new Error(`deadline exceeded after ${timeout}ms — ${note}`)));
      }, timeout);

      child.stdout.on('data', (data) => { stdout += data.toString(); });
      child.stderr.on('data', (data) => { stderr += data.toString(); });

      // Descendant sweep at settle: a parent that exits early leaves orphans
      // Windows' close does not report (the #3942 shape). Enumerate THIS
      // execution's descendants recursively by ParentProcessId — PID-scoped,
      // never image-name. Kill each, confirm, and report honestly.
      const descendants = () => new Promise((res) => {
        try {
          // Dump every PID/PPID once; the BFS runs in Node — doing it inside
          // PowerShell was O(processes × descendants) and stalled under load.
          const ps = spawn('powershell', ['-NoProfile', '-Command',
            `Get-CimInstance Win32_Process -ErrorAction SilentlyContinue|ForEach-Object{"$([int]$_.ProcessId) $([int]$_.ParentProcessId)"}`],
            { shell: false });
          if (!ps || !ps.stdout) return res([]); // spawn failed to produce a child — no sweep
          let raw = '';
          ps.stdout.on('data', (d) => (raw += d));
          ps.on('close', (psCode) => {
            const ppid = new Map();
            for (const line of raw.trim().split(/\r?\n/)) {
              const m = line.trim().split(/\s+/).map(Number);
              if (m.length >= 2 && Number.isFinite(m[0]) && Number.isFinite(m[1])) ppid.set(m[0], m[1]);
            }
            // A live Windows box enumerates hundreds of processes — an empty
            // or tiny dump means the sweep itself failed, not that the tree
            // is clean. Distinguish "no descendants" from "sweep inconclusive".
            if (psCode !== 0 || ppid.size < 100) return res(null);
            const out = [];
            const queue = [child.pid];
            const seen = new Set([child.pid]);
            while (queue.length) {
              const p = queue.shift();
              for (const [pid, pp] of ppid) {
                if (pp === p && !seen.has(pid)) { seen.add(pid); out.push(pid); queue.push(pid); }
              }
            }
            res(out);
          });
          ps.on('error', () => res(null));
        } catch { res([]); }
      });

      child.on('close', (code) => {
        if (process.platform === 'win32') {
          // close already means the parent exited — the deadline is moot for
          // termination. The sweep below is settlement bookkeeping; a child
          // that exits at T-ε must report its exit code, not "deadline".
          clearTimeout(deadline);
          const parentPid = child.pid;
          // The sweep is bounded too — a hung powershell cannot block settlement.
          // 30s: powershell+CIM is genuinely slow on a loaded Frank (~5-15s
          // observed); settlement latency is cheap insurance vs. false hangs.
          const sweep = Promise.race([
            descendants(),
            new Promise((r) => setTimeout(() => r(null), 30000)),
          ]);
          sweep.then(async (kids) => {
            if (kids === null) {
              // Sweep inconclusive — cannot confirm the tree is clean; do not
              // report a false success.
              const base = code === 0 ? `parent exited 0` : `Process exited with code ${code}`;
              return finish(() => reject(new Error(`${base} — descendant sweep inconclusive; orphans possible and NOT confirmed stopped`)));
            }
            const killed = [], alive = [];
            for (const pid of kids) {
              try { process.kill(pid, 'SIGKILL'); } catch { /* may already be gone */ }
              await new Promise((r) => setTimeout(r, 200));
              try { process.kill(pid, 0); alive.push(pid); } catch { killed.push(pid); }
            }
            finish(() => {
              if (alive.length) {
                reject(new Error(`cleanup FAILED — NOT confirmed stopped: orphaned descendants survive at PIDs ${alive.join(',')} (parent ${parentPid})`));
              } else if (killed.length) {
                reject(new Error(`parent exited ${code}; ${killed.length} orphaned descendant(s) killed by PID (${killed.join(',')}) — not a clean success`));
              } else if (deadlineFired) {
                reject(new Error(`deadline exceeded after ${timeout}ms`));
              } else if (code === 0) {
                resolve({ stdout, stderr, exitCode: code });
              } else {
                reject(new Error(`Process exited with code ${code}: ${stderr || stdout}`));
              }
            });
          }).catch(() => {
            // Sweep itself failed — still settle once, honestly.
            finish(() => reject(new Error('descendant sweep failed — outcome not confirmed')));
          });
          return;
        }
        finish(() => {
          if (deadlineFired) reject(new Error(`deadline exceeded after ${timeout}ms`));
          else if (code === 0) resolve({ stdout, stderr, exitCode: code });
          else reject(new Error(`Process exited with code ${code}: ${stderr || stdout}`));
        });
      });

      child.on('error', (error) => {
        finish(() => reject(error));
      });
    });
  }

  /**
   * Write file with safety checks
   */
  async writeFile(filePath, content) {
    const absolutePath = path.resolve(filePath);
    
    // Only allow writing to specific safe directories
    const safeDirs = [
      path.join(__dirname, '../../logs'),
      path.join(__dirname, '../../data'),
      path.join(__dirname, '../data')
    ];

    const isSafe = safeDirs.some(dir => absolutePath.startsWith(path.resolve(dir)));
    
    if (!isSafe) {
      throw new Error(`Write path not in safe directory: ${filePath}`);
    }

    // Ensure directory exists
    const dir = path.dirname(absolutePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    fs.writeFileSync(absolutePath, content, 'utf8');
    return { path: absolutePath, bytes: content.length };
  }

  /**
   * Read file with safety checks
   */
  async readFile(filePath) {
    const absolutePath = path.resolve(filePath);
    
    if (!fs.existsSync(absolutePath)) {
      throw new Error(`File not found: ${absolutePath}`);
    }

    const content = fs.readFileSync(absolutePath, 'utf8');
    return { path: absolutePath, content, bytes: content.length };
  }

  /**
   * API call with domain restrictions
   */
  async apiCall(url, options = {}) {
    const urlObj = new URL(url);
    
    // Safety check: Is domain approved?
    const isApproved = this.approvedDomains.some(domain => 
      urlObj.hostname === domain || urlObj.hostname.endsWith(`.${domain}`)
    );

    if (!isApproved) {
      throw new Error(`API domain not approved: ${urlObj.hostname}`);
    }

    // Use fetch or axios
    const axios = require('axios');
    const response = await axios({
      url,
      method: options.method || 'GET',
      headers: options.headers,
      data: options.body,
      timeout: 10000
    });

    return { status: response.status, data: response.data };
  }

  /**
   * Log event locally
   */
  async logEvent(eventType, payload) {
    const event = {
      event: eventType,
      timestamp: new Date().toISOString(),
      payload
    };

    console.log('[HEIDI Event]', JSON.stringify(event));
    return { logged: true };
  }

  /**
   * Get execution log
   */
  getExecutionLog(limit = 100) {
    return this.executionLog.slice(-limit);
  }

  /**
   * Full pre-flight validation used to decide whether an action may run
   * AUTONOMOUSLY (without a human). This mirrors the enforcement inside
   * execute()/runScript()/runCommand() so a hallucinated action can never
   * auto-fire just because its type is on the list.
   *
   * Returns true only for actions that are provably safe with no side effects
   * beyond approved directories/commands/domains.
   */
  isSafe(action) {
    try {
      if (!action || !this.approvedActions.has(action.type)) return false;

      switch (action.type) {
        case 'log_event':
          return true; // local console log only — always safe

        case 'read_file': {
          if (!action.target) return false;
          // No traversal, and must resolve inside the project tree.
          const abs = path.resolve(action.target);
          const root = path.resolve(path.join(__dirname, '../../'));
          return abs.startsWith(root);
        }

        case 'run_script': {
          if (!action.target) return false;
          const abs = path.resolve(action.target);
          const inApprovedDir = this.approvedScriptDirs.some(dir => abs.startsWith(path.resolve(dir)));
          const okExt = ['.js', '.ps1', '.sh'].includes(path.extname(abs).toLowerCase());
          const args = action.args || [];
          const argsClean = args.every(a =>
            !ActionExecutor.DANGEROUS_ARG_PATTERNS.some(re => re.test(String(a))));
          return inApprovedDir && okExt && fs.existsSync(abs) && argsClean;
        }

        case 'run_command': {
          if (!action.command || /\s/.test(action.command)) return false;
          const cmd = action.command.toLowerCase();
          if (!this.approvedCommands.has(cmd)) return false;
          const args = action.args || [];
          if (cmd === 'git' && args.length && ActionExecutor.BLOCKED_GIT_SUBCOMMANDS.has(String(args[0]).toLowerCase())) {
            return false;
          }
          return args.every(a =>
            !ActionExecutor.DANGEROUS_ARG_PATTERNS.some(re => re.test(String(a))));
        }

        // write_file and api_call have real side effects / exfil potential —
        // never allow them to run autonomously. They still work when invoked
        // explicitly via execute() with its own checks.
        case 'write_file':
        case 'api_call':
        default:
          return false;
      }
    } catch (error) {
      return false; // fail closed
    }
  }
}

module.exports = ActionExecutor;
