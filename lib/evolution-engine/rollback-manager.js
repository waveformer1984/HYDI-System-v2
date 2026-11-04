'use strict';

const fs = require('fs');
const path = require('path');

/**
 * File-level rollback for bounded evolution workspaces (never touches clean-main).
 */
class RollbackManager {
  /**
   * @param {{ workspaceRoot: string }} opts
   */
  constructor(opts) {
    this.workspaceRoot = opts.workspaceRoot;
    this.backupDir = path.join(this.workspaceRoot, '.evolution-backups');
  }

  ensureWorkspace() {
    fs.mkdirSync(this.workspaceRoot, { recursive: true });
    fs.mkdirSync(this.backupDir, { recursive: true });
  }

  /**
   * Snapshot a relative file before mutation.
   * @param {string} relPath
   * @param {string} attemptId
   */
  snapshot(relPath, attemptId) {
    this.ensureWorkspace();
    const abs = path.join(this.workspaceRoot, relPath);
    const stamp = path.join(this.backupDir, attemptId, relPath);
    fs.mkdirSync(path.dirname(stamp), { recursive: true });
    if (fs.existsSync(abs)) {
      fs.copyFileSync(abs, stamp);
      return { existed: true, backup: stamp };
    }
    fs.writeFileSync(stamp, '', { flag: 'w' }); // marker: file did not exist
    return { existed: false, backup: stamp };
  }

  /**
   * Restore all files backed up for attemptId.
   * @param {string} attemptId
   */
  rollback(attemptId) {
    const dir = path.join(this.backupDir, attemptId);
    if (!fs.existsSync(dir)) {
      return { ok: false, error: 'no_backup_for_attempt', attemptId };
    }
    const restored = [];
    const walk = (sub) => {
      for (const ent of fs.readdirSync(sub, { withFileTypes: true })) {
        const full = path.join(sub, ent.name);
        if (ent.isDirectory()) walk(full);
        else {
          const rel = path.relative(dir, full);
          const target = path.join(this.workspaceRoot, rel);
          const content = fs.readFileSync(full);
          if (content.length === 0 && !fs.existsSync(path.dirname(target))) {
            if (fs.existsSync(target)) fs.unlinkSync(target);
          } else if (content.length === 0) {
            if (fs.existsSync(target)) fs.unlinkSync(target);
          } else {
            fs.mkdirSync(path.dirname(target), { recursive: true });
            fs.copyFileSync(full, target);
          }
          restored.push(rel);
        }
      }
    };
    walk(dir);
    return { ok: true, attemptId, restored };
  }

  instructionsGit(attemptId, branchName) {
    return [
      `git checkout ${branchName || 'your-feature-branch'}`,
      'git reset --hard HEAD~1  # if commit was local only',
      `Evolution attempt ${attemptId} file backups under ${this.backupDir}/${attemptId}`,
    ];
  }
}

module.exports = { RollbackManager };
