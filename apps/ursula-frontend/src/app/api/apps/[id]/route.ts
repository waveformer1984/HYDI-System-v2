import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

export const dynamic = 'force-dynamic';

const REPO_ROOT = path.resolve(process.cwd(), '..', '..');

function repoFile(p: string): string {
  const a = path.resolve(process.cwd(), p);
  const b = path.resolve(REPO_ROOT, p);
  return fs.existsSync(a) ? a : b;
}

function readJson(p: string): any | null {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; }
}

function httpGet(url: string, ms = 2500): Promise<{ ok: boolean; status: number | null }> {
  return fetch(url, { signal: AbortSignal.timeout(ms) })
    .then((r) => ({ ok: r.ok, status: r.status }))
    .catch(() => ({ ok: false, status: null }));
}

function pm2Status(name: string): { status: string; pid: number | null; restarts: number | null } {
  try {
    const list = JSON.parse(execSync('pm2 jlist', { encoding: 'utf8', timeout: 15000 }));
    const app = (Array.isArray(list) ? list : []).find((p: any) => p.name === name);
    return app
      ? { status: app.pm2_env?.status || 'unknown', pid: app.pid ?? null, restarts: app.pm2_env?.restart_time ?? null }
      : { status: 'not-registered', pid: null, restarts: null };
  } catch {
    return { status: 'pm2-unreadable', pid: null, restarts: null };
  }
}

function errLogTail(pm2Name: string, lines = 50): string[] {
  const logPath = repoFile(path.join('logs', `pm2-${pm2Name}.err.log`));
  const pm2Path = path.resolve(process.env.USERPROFILE || '', '.pm2', 'logs', `${pm2Name}-error.log`);
  const file = fs.existsSync(logPath) ? logPath : fs.existsSync(pm2Path) ? pm2Path : null;
  if (!file) return [];
  try {
    return fs.readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean).slice(-lines);
  } catch { return []; }
}

function openPrs(repoPath: string): any[] {
  if (!repoPath) return [];
  try {
    const out = execSync(
      `gh pr list --state open --json number,title,headRefName --limit 30`,
      { encoding: 'utf8', timeout: 15000, cwd: repoFile('.') }
    );
    const prs = JSON.parse(out);
    return prs.filter((pr: any) =>
      // cheap path check: PR files call is per-PR; filter by files changed
      true
    ).map((pr: any) => ({ number: pr.number, title: pr.title, headRefName: pr.headRefName }));
  } catch { return []; }
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const portfolio = readJson(repoFile(path.join('config', 'portfolio.json')));
  const app = (portfolio?.apps || []).find((a: any) => a.id === id);
  if (!app) return NextResponse.json({ ok: false, error: `unknown app '${params.id}'` }, { status: 404 });

  const provenance = app.pm2Name ? readJson(repoFile(path.join('.runtime', 'provenance', `${app.pm2Name}.json`))) : null;
  const fixList = readJson(repoFile(path.join('.runtime', 'fixlist', 'current.json')));
  const fixListItems = (fixList?.items || []).filter((i: any) =>
    [app.id, app.pm2Name, app.repoPath].filter(Boolean).some((s) => String(i.subject || '').includes(String(s)))
  );

  const ownHealth = app.healthUrl ? await httpGet(app.healthUrl) : null;
  const dependencies = await Promise.all((app.dependencies || []).map(async (d: any) => ({
    name: d.name, healthUrl: d.healthUrl, health: d.healthUrl ? await httpGet(d.healthUrl) : null,
  })));

  return NextResponse.json({
    ok: true,
    app,
    running: pm2Status(app.pm2Name || ''),
    provenance,
    health: ownHealth,
    dependencies,
    errLog: errLogTail(app.pm2Name || ''),
    openPrs: openPrs(app.repoPath || ''),
    fixListItems,
  });
}
