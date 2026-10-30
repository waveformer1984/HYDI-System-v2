'use client';

import React, { useState, useMemo, useEffect } from 'react';
import { Search, Play, Folder } from 'lucide-react';
import { fetchPortfolio, DIVISIONS, type PortfolioApp } from '@/lib/portfolio';

export default function AppLauncherModule() {
  const [apps, setApps] = useState<PortfolioApp[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedDivision, setSelectedDivision] = useState<string>('all');
  const [selectedApp, setSelectedApp] = useState<PortfolioApp | null>(null);

  useEffect(() => {
    let live = true;
    fetchPortfolio()
      .then((list) => { if (live) setApps(list); })
      .catch((e) => { if (live) setLoadError(e?.message || 'portfolio load failed'); });
    return () => { live = false; };
  }, []);

  const filteredApps = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return apps.filter((app) => {
      if (selectedDivision !== 'all' && app.division !== selectedDivision) return false;
      if (!q) return true;
      return [app.name, app.description, app.pm2Name, app.repoPath]
        .filter(Boolean)
        .some((s) => String(s).toLowerCase().includes(q));
    });
  }, [apps, searchQuery, selectedDivision]);

  const appsByDivision = useMemo(() => {
    const grouped: Record<string, PortfolioApp[]> = {};
    filteredApps.forEach((app) => {
      (grouped[app.division] ||= []).push(app);
    });
    return grouped;
  }, [filteredApps]);

  const handleLaunchApp = (app: PortfolioApp) => {
    if (app.url) {
      window.open(app.url, '_blank');
    } else {
      alert(`${app.name}: no local URL (${app.kind === 'external' ? 'external entry' : 'not running or no port'})`);
    }
  };

  const handleCopyPath = (app: PortfolioApp) => {
    const p = app.repoPath || app.blueprintPath || '';
    navigator.clipboard.writeText(p);
    alert(`Path copied to clipboard:\n${p}`);
  };

  return (
    <div className="flex h-full bg-[#1e1e1e] text-[#cccccc]">
      <div className="w-64 border-r border-[#2d2d2d] flex flex-col">
        <div className="p-4 border-b border-[#2d2d2d]">
          <h2 className="text-lg font-semibold text-white mb-4">App Launcher</h2>
          <div className="relative mb-4">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#858585]" />
            <input
              type="text"
              placeholder="Search apps..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-3 py-2 bg-[#3c3c3c] border border-[#555555] rounded text-sm text-white placeholder-[#858585] focus:outline-none focus:border-[#007acc]"
            />
          </div>
          <div className="space-y-1">
            <button
              onClick={() => setSelectedDivision('all')}
              className={`w-full text-left px-3 py-2 rounded text-sm transition-colors ${
                selectedDivision === 'all' ? 'bg-[#37373d] text-white' : 'text-[#cccccc] hover:bg-[#2a2d2e]'
              }`}
            >
              <span className="mr-2">📦</span> All Apps ({apps.length})
            </button>
            {DIVISIONS.map((d) => {
              const count = apps.filter((a) => a.division === d.id).length;
              return (
                <button
                  key={d.id}
                  onClick={() => setSelectedDivision(d.id)}
                  className={`w-full text-left px-3 py-2 rounded text-sm transition-colors ${
                    selectedDivision === d.id ? 'bg-[#37373d] text-white' : 'text-[#cccccc] hover:bg-[#2a2d2e]'
                  }`}
                >
                  <span className="mr-2">{d.icon}</span> {d.name} ({count})
                </button>
              );
            })}
          </div>
        </div>
        <div className="p-4 text-xs text-[#858585] border-t border-[#2d2d2d] mt-auto">
          <div className="space-y-1">
            <div>Total Apps: {apps.length}</div>
            <div>Local: {apps.filter((a) => a.kind === 'local').length}</div>
            <div>Suite: {apps.filter((a) => a.kind === 'suite').length}</div>
            {loadError && <div className="text-red-400">registry: {loadError}</div>}
          </div>
        </div>
      </div>

      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="p-4 border-b border-[#2d2d2d]">
          <h3 className="text-sm font-semibold text-white">
            {selectedDivision === 'all' ? 'All Applications' : DIVISIONS.find((d) => d.id === selectedDivision)?.name}
          </h3>
          <p className="text-xs text-[#858585] mt-1">{filteredApps.length} app{filteredApps.length !== 1 ? 's' : ''} found</p>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {Object.entries(appsByDivision).map(([division, list]) => {
            const dInfo = DIVISIONS.find((d) => d.id === division);
            return (
              <div key={division} className="mb-6">
                <h4 className="text-sm font-semibold text-white mb-3 flex items-center">
                  <span className="mr-2">{dInfo?.icon}</span>
                  {dInfo?.name || division}
                  <span className="ml-2 text-xs text-[#858585]">({list.length})</span>
                </h4>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                  {list.map((app) => (
                    <div
                      key={app.id}
                      className="bg-[#252526] border border-[#2d2d2d] rounded-lg p-4 hover:border-[#007acc] transition-colors cursor-pointer group"
                      onClick={() => setSelectedApp(app)}
                    >
                      <div className="flex items-start justify-between mb-2">
                        <div className="flex items-center gap-2">
                          <span className="text-2xl">{app.icon}</span>
                          <div>
                            <h5 className="text-sm font-semibold text-white group-hover:text-[#007acc]">{app.name}</h5>
                            <p className="text-xs text-[#858585]">{app.kind}{app.pm2Name ? ` · ${app.pm2Name}` : ''}</p>
                          </div>
                        </div>
                        <div className={`w-2 h-2 rounded-full ${app.embeddable === false ? 'bg-yellow-500' : 'bg-green-500'}`} />
                      </div>
                      <p className="text-xs text-[#cccccc] mb-3 line-clamp-2">{app.description}</p>
                      <div className="flex gap-2">
                        <button
                          onClick={(e) => { e.stopPropagation(); handleLaunchApp(app); }}
                          className="flex-1 flex items-center justify-center gap-2 px-3 py-2 bg-[#0e639c] hover:bg-[#1177bb] text-white text-xs rounded transition-colors"
                        >
                          <Play className="w-3 h-3" /> Launch
                        </button>
                        <button
                          onClick={(e) => { e.stopPropagation(); handleCopyPath(app); }}
                          className="px-3 py-2 bg-[#3c3c3c] hover:bg-[#505050] text-white text-xs rounded transition-colors"
                          title="Copy path"
                        >
                          <Folder className="w-3 h-3" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
          {filteredApps.length === 0 && (
            <div className="text-center py-12 text-[#858585]">
              <Search className="w-12 h-12 mx-auto mb-4 opacity-50" />
              <p>{apps.length === 0 ? 'Portfolio registry not loaded' : 'No apps found matching your criteria'}</p>
            </div>
          )}
        </div>
      </div>

      {selectedApp && (
        <div className="w-96 border-l border-[#2d2d2d] bg-[#252526] overflow-y-auto">
          <div className="p-4 border-b border-[#2d2d2d] flex items-center justify-between">
            <h3 className="text-sm font-semibold text-white">App Details</h3>
            <button onClick={() => setSelectedApp(null)} className="text-[#858585] hover:text-white">✕</button>
          </div>
          <div className="p-4 space-y-4">
            <div className="flex items-center gap-3">
              <span className="text-4xl">{selectedApp.icon}</span>
              <div>
                <h4 className="text-lg font-semibold text-white">{selectedApp.name}</h4>
                <p className="text-xs text-[#858585]">{selectedApp.id}</p>
              </div>
            </div>
            {[
              ['Kind', selectedApp.kind],
              ['Division', selectedApp.division],
              ['Path', selectedApp.repoPath || selectedApp.blueprintPath || selectedApp.url],
              ['PM2', selectedApp.pm2Name || 'none'],
              ['Port', selectedApp.port ?? '—'],
              ['Health', selectedApp.healthUrl || '—'],
              ['Stripe', selectedApp.stripeMode || 'none'],
              ['Embeddable', selectedApp.embeddable === false ? `no — ${selectedApp.notEmbeddableReason || 'frame headers'}` : 'yes'],
            ].map(([k, v]) => (
              <div key={String(k)}>
                <label className="text-xs text-[#858585] uppercase">{k}</label>
                <p className="text-xs text-[#cccccc] mt-1 font-mono bg-[#1e1e1e] p-2 rounded break-all">{String(v)}</p>
              </div>
            ))}
            <div className="pt-4 space-y-2">
              <button
                onClick={() => handleLaunchApp(selectedApp)}
                className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-[#0e639c] hover:bg-[#1177bb] text-white text-sm rounded transition-colors"
              >
                <Play className="w-4 h-4" /> Launch Application
              </button>
              <button
                onClick={() => handleCopyPath(selectedApp)}
                className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-[#3c3c3c] hover:bg-[#505050] text-white text-sm rounded transition-colors"
              >
                <Folder className="w-4 h-4" /> Copy Path to Clipboard
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
