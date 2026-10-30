'use client';

import React, { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';

interface DevData {
  ok: boolean;
  app: any;
  running: { status: string; pid: number | null; restarts: number | null };
  provenance: { gitSha?: string | null; pid?: number; startedAt?: string } | null;
  health: { ok: boolean; status: number | null } | null;
  dependencies: { name: string; healthUrl: string; health: { ok: boolean; status: number | null } | null }[];
  errLog: string[];
  openPrs: { number: number; title: string; headRefName: string }[];
  fixListItems: any[];
}

export default function AppWorkspacePage() {
  const { id } = useParams() as { id: string };
  const [data, setData] = useState<DevData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/apps/${id}`, { cache: 'no-store' })
      .then((r) => r.json())
      .then((d) => (d.ok ? setData(d) : setError(d.error || 'load failed')))
      .catch((e) => setError(e.message));
  }, [id]);

  const running = data?.running.status === 'online' || data?.running.status === 'launching';
  const appUrl = data?.app.appPaneUrl || data?.app.localUrl;

  return (
    <div className="flex h-full bg-[#1e1e1e] text-[#cccccc]">
      {/* Dev pane */}
      <div className="w-[420px] border-r border-[#2d2d2d] overflow-y-auto p-4 space-y-4 text-xs">
        <h2 className="text-lg font-semibold text-white">{data?.app.name || id}</h2>
        {error && <div className="text-red-400">{error}</div>}
        {!data && !error && <div className="text-[#858585]">loading…</div>}

        {data && (
          <>
            <section>
              <h3 className="text-[#858585] uppercase mb-1">Process</h3>
              <div className="font-mono bg-[#252526] p-2 rounded space-y-1">
                <div>pm2: {data.app.pm2Name || 'none'} → {data.running.status}{data.running.pid ? ` (pid ${data.running.pid})` : ''}{data.running.restarts != null ? ` ↺${data.running.restarts}` : ''}</div>
                <div>sha: {data.provenance?.gitSha?.slice(0, 10) || 'no provenance'}</div>
                <div>health: {data.health ? (data.health.ok ? `ok (${data.health.status})` : `fail (${data.health.status ?? 'unreachable'})`) : 'no healthUrl'}</div>
                {data.dependencies.map((d) => (
                  <div key={d.name}>dep {d.name}: {d.health ? (d.health.ok ? `ok (${d.health.status})` : `fail (${d.health.status ?? 'unreachable'})`) : '—'}</div>
                ))}
              </div>
            </section>

            {!running && (
              <button
                onClick={() => fetch(`/api/apps/${id}/start`, { method: 'POST' }).then((r) => r.json()).then((j) => alert(j.ok ? `mission filed: ${j.missionId || 'ok'}` : j.error || 'refused')).catch((e) => alert(e.message))}
                className="px-4 py-2 bg-[#0e639c] hover:bg-[#1177bb] text-white rounded text-sm"
              >
                Start (files a heidi-core restart-module mission)
              </button>
            )}

            <section>
              <h3 className="text-[#858585] uppercase mb-1">Fix-list items</h3>
              <div className="bg-[#252526] p-2 rounded space-y-1">
                {data.fixListItems.length === 0 && <div className="text-[#858585]">none</div>}
                {data.fixListItems.map((i: any) => (
                  <div key={i.id} className="font-mono">[{i.level}] {i.subject} — {i.detail || i.kind}</div>
                ))}
              </div>
            </section>

            <section>
              <h3 className="text-[#858585] uppercase mb-1">Open PRs (repo-wide)</h3>
              <div className="bg-[#252526] p-2 rounded space-y-1">
                {data.openPrs.length === 0 && <div className="text-[#858585]">none / gh unavailable</div>}
                {data.openPrs.map((p) => (
                  <div key={p.number} className="font-mono">#{p.number} {p.title} <span className="text-[#858585]">({p.headRefName})</span></div>
                ))}
              </div>
            </section>

            <section>
              <h3 className="text-[#858585] uppercase mb-1">Last {data.errLog.length} err lines</h3>
              <pre className="bg-[#252526] p-2 rounded whitespace-pre-wrap break-all max-h-64 overflow-y-auto">
                {data.errLog.length ? data.errLog.join('\n') : 'no err log'}
              </pre>
            </section>
          </>
        )}
      </div>

      {/* App pane */}
      <div className="flex-1 flex flex-col">
        {data && data.app.stripeMode && !['none', 'test'].includes(data.app.stripeMode) && (
          <div className="px-4 py-2 bg-yellow-900/60 border-b border-yellow-700 text-yellow-200 text-xs">
            Orders here create REAL checkouts via {data.app.paymentPath || 'heidi-web'} — stripeMode: {data.app.stripeMode}
          </div>
        )}
        {running && appUrl && data?.app.embeddable !== false ? (
          <iframe src={appUrl} className="flex-1 w-full border-0" title={data.app.name} />
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center gap-3 text-[#858585]">
            {data?.app.embeddable === false ? (
              <>
                <p>Not embeddable — {data.app.notEmbeddableReason || 'frame headers'}</p>
                {appUrl && <button onClick={() => window.open(appUrl, '_blank')} className="px-4 py-2 bg-[#0e639c] text-white rounded text-sm">Open in new tab</button>}
              </>
            ) : (
              <p>{data ? 'App is not running' : '…'}</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
