'use strict';

/**
 * Stamp the commit that produced `.next` into `.next/hydi-build.json`.
 * `next start` serves the build, not whatever the working tree is later.
 * Run after `next build` — Next wipes `.next` during the build.
 * A missing git identity is written as null. It is never invented.
 */

const fs = require('fs');
const path = require('path');
const { resolveGitIdentity } = require('../lib/runtime/provenance');

async function stampBuild(opts = {}) {
  const root = opts.root || process.cwd();
  const fsImpl = opts.fs || fs;
  const identity = await resolveGitIdentity({
    cwd: root,
    env: opts.env || process.env,
    execFile: opts.execFile,
    timeoutMs: opts.timeoutMs,
  });
  const stampedAt = opts.now ? new Date(opts.now()).toISOString() : new Date().toISOString();
  const body = {
    gitSha: identity.gitSha,
    branch: identity.branch,
    gitDirty: identity.gitDirty,
    stampedAt,
    source: identity.source,
  };
  // frank-auto-deploy builds into a staging dir (HYDI_NEXT_DIST_DIR) and
  // renames it to .next afterwards; stamp wherever the build actually went.
  const dir = path.join(root, (opts.env || process.env).HYDI_NEXT_DIST_DIR || '.next');
  fsImpl.mkdirSync(dir, { recursive: true });
  const target = path.join(dir, 'hydi-build.json');
  const tmp = `${target}.tmp-${process.pid}`;
  fsImpl.writeFileSync(tmp, JSON.stringify(body));
  fsImpl.renameSync(tmp, target);
  return body;
}

if (require.main === module) {
  stampBuild()
    .then((body) => {
      if (!body.gitSha) {
        console.error('[stamp-hydi-build] gitSha is null — heidi-web will report UNKNOWN_CODE until a build records a commit');
      } else {
        console.log(`[stamp-hydi-build] ${body.gitSha}${body.gitDirty ? ' (dirty)' : ''}`);
      }
    })
    .catch((e) => {
      console.error(`[stamp-hydi-build] ${e instanceof Error ? e.message : 'stamp failed'}`);
      process.exitCode = 1;
    });
}

module.exports = { stampBuild };
