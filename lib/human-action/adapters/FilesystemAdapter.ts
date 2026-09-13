/**
 * HYDI Filesystem Action Adapter
 *
 * Implements filesystem operations: read, write, move, delete, create_directory.
 *
 * Safety:
 *   - Delete operations create a backup before deletion
 *   - Write operations create a backup of existing files before overwriting
 *   - All operations verify the result
 *   - Secret material is never logged
 */

import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import type {
  ActionAdapter,
  ActionExecutionContext,
  ActionExecutionResult,
  ActionObservation,
  ActionVerificationResult,
  HumanAction,
  RollbackResult,
} from '../HumanActionTypes';

export class FilesystemAdapter implements ActionAdapter {
  adapterId = 'filesystem';
  category = 'SYSTEM' as const;
  capabilities = [
    'filesystem.read_file',
    'filesystem.write_file',
    'filesystem.create_directory',
    'filesystem.move_file',
    'filesystem.delete_file',
  ];

  private backupDir: string;

  constructor(backupDir?: string) {
    this.backupDir = backupDir || path.resolve(process.cwd(), '.hydi-operational', 'action-backups');
  }

  async execute(
    action: HumanAction,
    _context: ActionExecutionContext,
  ): Promise<ActionExecutionResult> {
    const startTime = Date.now();
    const preState = await this.observe(action.target, _context).catch(() => undefined);

    try {
      let output: unknown;
      const evidence: ActionExecutionResult['evidence'] = [];

      switch (action.capability) {
        case 'filesystem.read_file':
          output = await this.readFile(action);
          evidence.push({
            check: 'file_read',
            status: 'pass',
            value: `Read ${Buffer.byteLength(String(output))} bytes`,
            checkedAt: new Date().toISOString(),
          });
          break;

        case 'filesystem.write_file':
          output = await this.writeFile(action);
          evidence.push({
            check: 'file_written',
            status: 'pass',
            value: `Wrote to ${action.target}`,
            checkedAt: new Date().toISOString(),
          });
          break;

        case 'filesystem.create_directory':
          output = await this.createDirectory(action);
          evidence.push({
            check: 'directory_created',
            status: 'pass',
            value: `Created ${action.target}`,
            checkedAt: new Date().toISOString(),
          });
          break;

        case 'filesystem.move_file':
          output = await this.moveFile(action);
          evidence.push({
            check: 'file_moved',
            status: 'pass',
            value: `Moved to ${action.parameters.destination ?? action.target}`,
            checkedAt: new Date().toISOString(),
          });
          break;

        case 'filesystem.delete_file':
          output = await this.deleteFile(action);
          evidence.push({
            check: 'file_deleted',
            status: 'pass',
            value: `Deleted ${action.target}`,
            checkedAt: new Date().toISOString(),
          });
          break;

        default:
          return {
            executed: false,
            output: null,
            error: `Unsupported capability: ${action.capability}`,
            evidence: [],
            durationMs: Date.now() - startTime,
          };
      }

      const postState = await this.observe(action.target, _context).catch(() => undefined);

      return {
        executed: true,
        output,
        error: null,
        evidence,
        durationMs: Date.now() - startTime,
        preExecutionState: preState,
        postExecutionState: postState,
      };
    } catch (error) {
      return {
        executed: false,
        output: null,
        error: error instanceof Error ? error.message : 'Unknown error',
        evidence: [{
          check: 'execution_error',
          status: 'fail',
          value: error instanceof Error ? error.message : 'Unknown error',
          checkedAt: new Date().toISOString(),
        }],
        durationMs: Date.now() - startTime,
        preExecutionState: preState,
      };
    }
  }

  async verify(
    action: HumanAction,
    executionResult: ActionExecutionResult,
    _context: ActionExecutionContext,
  ): Promise<ActionVerificationResult> {
    const evidence: ActionVerificationResult['evidence'] = [];

    if (!executionResult.executed) {
      return {
        verified: false,
        evidence,
        reason: 'Action was not executed',
      };
    }

    switch (action.capability) {
      case 'filesystem.read_file': {
        evidence.push({
          check: 'content_returned',
          status: executionResult.output ? 'pass' : 'fail',
          value: executionResult.output ? 'Content returned' : 'No content',
          checkedAt: new Date().toISOString(),
        });
        return {
          verified: !!executionResult.output,
          evidence,
          reason: executionResult.output ? 'File read verified' : 'No content returned',
        };
      }

      case 'filesystem.write_file': {
        const exists = fs.existsSync(action.target);
        evidence.push({
          check: 'file_exists',
          status: exists ? 'pass' : 'fail',
          value: exists ? 'File exists' : 'File does not exist',
          checkedAt: new Date().toISOString(),
        });
        return {
          verified: exists,
          evidence,
          reason: exists ? 'File written and verified' : 'File not found after write',
        };
      }

      case 'filesystem.create_directory': {
        const exists = fs.existsSync(action.target);
        const isDir = exists && fs.statSync(action.target).isDirectory();
        evidence.push({
          check: 'directory_exists',
          status: isDir ? 'pass' : 'fail',
          value: isDir ? 'Directory exists' : 'Directory does not exist',
          checkedAt: new Date().toISOString(),
        });
        return {
          verified: !!isDir,
          evidence,
          reason: isDir ? 'Directory created and verified' : 'Directory not found',
        };
      }

      case 'filesystem.move_file': {
        const dest = action.parameters.destination as string ?? action.target;
        const oldExists = fs.existsSync(action.target);
        const newExists = fs.existsSync(dest);
        evidence.push({
          check: 'file_at_new_location',
          status: newExists ? 'pass' : 'fail',
          value: newExists ? 'File at new location' : 'File not at new location',
          checkedAt: new Date().toISOString(),
        });
        evidence.push({
          check: 'file_not_at_old_location',
          status: !oldExists ? 'pass' : 'fail',
          value: !oldExists ? 'Old path cleared' : 'Old path still exists',
          checkedAt: new Date().toISOString(),
        });
        return {
          verified: newExists && !oldExists,
          evidence,
          reason: newExists && !oldExists ? 'Move verified' : 'Move verification failed',
        };
      }

      case 'filesystem.delete_file': {
        const exists = fs.existsSync(action.target);
        evidence.push({
          check: 'file_not_exists',
          status: !exists ? 'pass' : 'fail',
          value: !exists ? 'File deleted' : 'File still exists',
          checkedAt: new Date().toISOString(),
        });
        return {
          verified: !exists,
          evidence,
          reason: !exists ? 'Deletion verified' : 'File still exists',
        };
      }

      default:
        return { verified: false, evidence, reason: 'Unknown capability' };
    }
  }

  async rollback(
    action: HumanAction,
    executionResult: ActionExecutionResult,
    _context: ActionExecutionContext,
  ): Promise<RollbackResult> {
    try {
      switch (action.capability) {
        case 'filesystem.write_file': {
          // Restore from backup if available
          const backupPath = (executionResult.preExecutionState as ActionObservation)?.properties?.backupPath as string;
          if (backupPath && fs.existsSync(backupPath)) {
            const content = fs.readFileSync(backupPath);
            fs.writeFileSync(action.target, content);
            return {
              attempted: true,
              succeeded: true,
              evidence: `Restored from backup: ${backupPath}`,
            };
          }
          // If no backup existed (file was new), delete the created file
          if (fs.existsSync(action.target)) {
            fs.unlinkSync(action.target);
            return {
              attempted: true,
              succeeded: true,
              evidence: 'Deleted created file (no prior backup)',
            };
          }
          return { attempted: true, succeeded: true, evidence: 'Nothing to roll back' };
        }

        case 'filesystem.create_directory': {
          if (fs.existsSync(action.target) && fs.statSync(action.target).isDirectory()) {
            fs.rmdirSync(action.target);
            return { attempted: true, succeeded: true, evidence: 'Removed created directory' };
          }
          return { attempted: true, succeeded: true, evidence: 'Directory not present' };
        }

        case 'filesystem.move_file': {
          const dest = action.parameters.destination as string ?? action.target;
          if (fs.existsSync(dest)) {
            fs.renameSync(dest, action.target);
            return { attempted: true, succeeded: true, evidence: 'Moved file back' };
          }
          return { attempted: true, succeeded: false, evidence: 'Destination file not found for rollback' };
        }

        case 'filesystem.delete_file': {
          // Restore from backup
          const backupPath = (executionResult.preExecutionState as ActionObservation)?.properties?.backupPath as string;
          if (backupPath && fs.existsSync(backupPath)) {
            const content = fs.readFileSync(backupPath);
            fs.writeFileSync(action.target, content);
            return { attempted: true, succeeded: true, evidence: `Restored from backup: ${backupPath}` };
          }
          return {
            attempted: true,
            succeeded: false,
            evidence: 'No backup available for restoration',
            error: 'Cannot restore deleted file — no backup',
          };
        }

        case 'filesystem.read_file':
          return { attempted: true, succeeded: true, evidence: 'Read operation needs no rollback' };

        default:
          return { attempted: false, succeeded: false, evidence: 'No rollback strategy', error: 'Unknown capability' };
      }
    } catch (error) {
      return {
        attempted: true,
        succeeded: false,
        evidence: 'Rollback failed',
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  isAvailable(): { available: boolean; reason: string | null } {
    return { available: true, reason: null };
  }

  async observe(target: string, _context: ActionExecutionContext): Promise<ActionObservation> {
    const exists = fs.existsSync(target);
    let state = 'not_found';
    const properties: Record<string, unknown> = {};

    if (exists) {
      const stat = fs.statSync(target);
      if (stat.isDirectory()) {
        state = 'directory';
        properties.entryCount = fs.readdirSync(target).length;
      } else {
        state = 'file';
        properties.size = stat.size;
        properties.modifiedAt = stat.mtime.toISOString();

        // Create backup for files that might be overwritten
        if (stat.size > 0) {
          if (!fs.existsSync(this.backupDir)) {
            fs.mkdirSync(this.backupDir, { recursive: true });
          }
          const backupName = `${path.basename(target)}.${randomUUID().slice(0, 8)}.bak`;
          const backupPath = path.resolve(this.backupDir, backupName);
          fs.copyFileSync(target, backupPath);
          properties.backupPath = backupPath;
        }
      }
    }

    return {
      target,
      exists,
      state,
      properties,
      observedAt: new Date().toISOString(),
    };
  }

  // -----------------------------------------------------------------------
  // Private operation implementations
  // -----------------------------------------------------------------------

  private async readFile(action: HumanAction): Promise<string> {
    const target = action.target;
    if (!fs.existsSync(target)) {
      throw new Error(`File not found: ${target}`);
    }
    const encoding = (action.parameters.encoding as BufferEncoding) ?? 'utf-8';
    return fs.readFileSync(target, encoding);
  }

  private async writeFile(action: HumanAction): Promise<{ bytesWritten: number }> {
    const target = action.target;
    const content = action.parameters.content as string;
    if (content === undefined) {
      throw new Error('No content provided for write_file');
    }
    // Ensure parent directory exists
    const parent = path.dirname(target);
    if (!fs.existsSync(parent)) {
      fs.mkdirSync(parent, { recursive: true });
    }
    fs.writeFileSync(target, content);
    return { bytesWritten: Buffer.byteLength(content) };
  }

  private async createDirectory(action: HumanAction): Promise<{ created: boolean }> {
    const target = action.target;
    if (fs.existsSync(target)) {
      if (!fs.statSync(target).isDirectory()) {
        throw new Error(`Path exists but is not a directory: ${target}`);
      }
      return { created: false };
    }
    fs.mkdirSync(target, { recursive: true });
    return { created: true };
  }

  private async moveFile(action: HumanAction): Promise<{ moved: boolean }> {
    const source = action.target;
    const dest = action.parameters.destination as string;
    if (!dest) {
      throw new Error('No destination provided for move_file');
    }
    if (!fs.existsSync(source)) {
      throw new Error(`Source file not found: ${source}`);
    }
    // Ensure parent of destination exists
    const parent = path.dirname(dest);
    if (!fs.existsSync(parent)) {
      fs.mkdirSync(parent, { recursive: true });
    }
    fs.renameSync(source, dest);
    return { moved: true };
  }

  private async deleteFile(action: HumanAction): Promise<{ deleted: boolean; backupPath?: string }> {
    const target = action.target;
    if (!fs.existsSync(target)) {
      return { deleted: false };
    }

    // Create backup before deletion
    if (!fs.existsSync(this.backupDir)) {
      fs.mkdirSync(this.backupDir, { recursive: true });
    }
    const backupName = `${path.basename(target)}.${randomUUID().slice(0, 8)}.bak`;
    const backupPath = path.resolve(this.backupDir, backupName);

    const stat = fs.statSync(target);
    if (stat.isDirectory()) {
      // Copy directory for backup
      fs.cpSync(target, backupPath, { recursive: true });
      fs.rmSync(target, { recursive: true });
    } else {
      fs.copyFileSync(target, backupPath);
      fs.unlinkSync(target);
    }

    return { deleted: true, backupPath };
  }
}
