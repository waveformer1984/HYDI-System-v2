'use strict';

/**
 * Shared helpers for cloud-bootstrap modules.
 * SECURITY: nothing in this file may print, log, or return secret VALUES in
 * human-readable output. Tokens are held in memory and passed as headers only.
 */

const { execFileSync } = require('child_process');

// cmd.exe double-quote escaping for a single argument. Safe for the simple,
// programmer-controlled args this module passes (CLI flags/names) — never
// build args here from unsanitized external input.
function cmdQuote(arg) {
  const s = String(arg);
  if (/["\s&|<>^%]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

/** Run a CLI, capture stdout, never echo the command's env. */
function run(cmd, args, { timeoutMs = 60_000 } = {}) {
  try {
    // Windows cannot execFileSync a .cmd/.bat shim directly (CreateProcess
    // rejects it — EINVAL); Node's own docs say such files require shell:true.
    // With shell:true, Node no longer escapes array args itself, so this
    // module quotes them manually rather than relying on the interpolation
    // Node warns is unsafe.
    const needsShell = process.platform === 'win32' && /\.(cmd|bat)$/i.test(cmd);
    const stdout = needsShell
      ? execFileSync([cmd, ...args.map(cmdQuote)].join(' '), [], {
          encoding: 'utf8',
          timeout: timeoutMs,
          windowsHide: true,
          shell: true,
          stdio: ['ignore', 'pipe', 'pipe'],
        })
      : execFileSync(cmd, args, {
          encoding: 'utf8',
          timeout: timeoutMs,
          windowsHide: true,
          stdio: ['ignore', 'pipe', 'pipe'],
        });
    return { ok: true, stdout };
  } catch (error) {
    return { ok: false, stdout: error.stdout || '', stderr: error.stderr || '', message: error.message };
  }
}

/**
 * Resolve the Supabase Management API token WITHOUT printing it:
 *  1. SUPABASE_ACCESS_TOKEN env var
 *  2. Windows Credential Manager entry the supabase CLI writes on `supabase login`
 * Returns the token string or null. Callers must never log it.
 */
function getSupabaseAccessToken() {
  if (process.env.SUPABASE_ACCESS_TOKEN) return process.env.SUPABASE_ACCESS_TOKEN.trim();
  if (process.platform !== 'win32') return null;

  const ps = `
$sig = @'
using System;
using System.Runtime.InteropServices;
public class CredManCB {
  [DllImport("advapi32.dll", EntryPoint="CredReadW", CharSet=CharSet.Unicode, SetLastError=true)]
  public static extern bool CredRead(string target, uint type, uint flags, out IntPtr credPtr);
  [DllImport("advapi32.dll")]
  public static extern void CredFree(IntPtr cred);
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)]
  public struct CREDENTIAL {
    public uint Flags; public uint Type; public string TargetName; public string Comment;
    public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten;
    public uint CredentialBlobSize; public IntPtr CredentialBlob; public uint Persist;
    public uint AttributeCount; public IntPtr Attributes; public string TargetAlias; public string UserName;
  }
}
'@
Add-Type -TypeDefinition $sig -ErrorAction SilentlyContinue
$ptr = [IntPtr]::Zero
if ([CredManCB]::CredRead('Supabase CLI:supabase', 1, 0, [ref]$ptr)) {
  $cred = [System.Runtime.InteropServices.Marshal]::PtrToStructure($ptr, [type][CredManCB+CREDENTIAL])
  $bytes = New-Object byte[] $cred.CredentialBlobSize
  [System.Runtime.InteropServices.Marshal]::Copy($cred.CredentialBlob, $bytes, 0, $cred.CredentialBlobSize)
  [CredManCB]::CredFree($ptr)
  [Console]::Out.Write([System.Text.Encoding]::UTF8.GetString($bytes).Trim())
}
`;
  const res = run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], { timeoutMs: 30_000 });
  const token = (res.stdout || '').trim();
  return token.startsWith('sbp_') ? token : null;
}

/** Minimal fetch against the Supabase Management API. Token stays in memory. */
async function managementApi(token, method, apiPath, body) {
  const res = await fetch(`https://api.supabase.com/v1${apiPath}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try { json = await res.json(); } catch { /* empty bodies are fine */ }
  return { status: res.status, ok: res.ok, json };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

module.exports = { run, getSupabaseAccessToken, managementApi, sleep };
