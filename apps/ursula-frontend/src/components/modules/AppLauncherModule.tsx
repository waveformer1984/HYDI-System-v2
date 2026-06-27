'use client';

import React, { useState, useMemo } from 'react';
import { Search, ExternalLink, Play, Folder, Tag } from 'lucide-react';
import { APP_REGISTRY, CATEGORIES, getAppsByCategory, searchApps, type AppMetadata } from '@/lib/appRegistry';

export default function AppLauncherModule() {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [selectedApp, setSelectedApp] = useState<AppMetadata | null>(null);

  const filteredApps = useMemo(() => {
    let apps = APP_REGISTRY;

    // Filter by search
    if (searchQuery.trim()) {
      apps = searchApps(searchQuery);
    }

    // Filter by category
    if (selectedCategory !== 'all') {
      apps = apps.filter(app => app.category === selectedCategory);
    }

    return apps;
  }, [searchQuery, selectedCategory]);

  const appsByCategory = useMemo(() => {
    const grouped: Record<string, AppMetadata[]> = {};
    filteredApps.forEach(app => {
      if (!grouped[app.category]) {
        grouped[app.category] = [];
      }
      grouped[app.category].push(app);
    });
    return grouped;
  }, [filteredApps]);

  const handleLaunchApp = (app: AppMetadata) => {
    if (app.url) {
      window.open(app.url, '_blank');
    } else if (app.port) {
      window.open(`http://localhost:${app.port}`, '_blank');
    } else {
      alert(`App path: ${app.path}\nRun: ${app.devCommand || app.buildCommand || 'See package.json'}`);
    }
  };

  const handleOpenFolder = (app: AppMetadata) => {
    // Copy path to clipboard
    navigator.clipboard.writeText(app.path);
    alert(`Path copied to clipboard:\n${app.path}`);
  };

  return (
    <div className="flex h-full bg-[#1e1e1e] text-[#cccccc]">
      {/* Sidebar */}
      <div className="w-64 border-r border-[#2d2d2d] flex flex-col">
        <div className="p-4 border-b border-[#2d2d2d]">
          <h2 className="text-lg font-semibold text-white mb-4">App Launcher</h2>
          
          {/* Search */}
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

          {/* Category Filter */}
          <div className="space-y-1">
            <button
              onClick={() => setSelectedCategory('all')}
              className={`w-full text-left px-3 py-2 rounded text-sm transition-colors ${
                selectedCategory === 'all'
                  ? 'bg-[#37373d] text-white'
                  : 'text-[#cccccc] hover:bg-[#2a2d2e]'
              }`}
            >
              <span className="mr-2">📦</span> All Apps ({APP_REGISTRY.length})
            </button>
            {CATEGORIES.map(cat => {
              const count = getAppsByCategory(cat.id as any).length;
              return (
                <button
                  key={cat.id}
                  onClick={() => setSelectedCategory(cat.id)}
                  className={`w-full text-left px-3 py-2 rounded text-sm transition-colors ${
                    selectedCategory === cat.id
                      ? 'bg-[#37373d] text-white'
                      : 'text-[#cccccc] hover:bg-[#2a2d2e]'
                  }`}
                >
                  <span className="mr-2">{cat.icon}</span> {cat.name} ({count})
                </button>
              );
            })}
          </div>
        </div>

        {/* Stats */}
        <div className="p-4 text-xs text-[#858585] border-t border-[#2d2d2d] mt-auto">
          <div className="space-y-1">
            <div>Total Apps: {APP_REGISTRY.length}</div>
            <div>Active: {APP_REGISTRY.filter(a => a.status === 'active').length}</div>
            <div>Pending: {APP_REGISTRY.filter(a => a.status === 'pending').length}</div>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Header */}
        <div className="p-4 border-b border-[#2d2d2d]">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-semibold text-white">
                {selectedCategory === 'all' ? 'All Applications' : CATEGORIES.find(c => c.id === selectedCategory)?.name}
              </h3>
              <p className="text-xs text-[#858585] mt-1">
                {filteredApps.length} app{filteredApps.length !== 1 ? 's' : ''} found
              </p>
            </div>
          </div>
        </div>

        {/* App Grid */}
        <div className="flex-1 overflow-y-auto p-4">
          {Object.entries(appsByCategory).map(([category, apps]) => {
            const catInfo = CATEGORIES.find(c => c.id === category);
            return (
              <div key={category} className="mb-6">
                <h4 className="text-sm font-semibold text-white mb-3 flex items-center">
                  <span className="mr-2">{catInfo?.icon}</span>
                  {catInfo?.name}
                  <span className="ml-2 text-xs text-[#858585]">({apps.length})</span>
                </h4>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                  {apps.map(app => (
                    <div
                      key={app.id}
                      className="bg-[#252526] border border-[#2d2d2d] rounded-lg p-4 hover:border-[#007acc] transition-colors cursor-pointer group"
                      onClick={() => setSelectedApp(app)}
                    >
                      <div className="flex items-start justify-between mb-2">
                        <div className="flex items-center gap-2">
                          <span className="text-2xl">{app.icon}</span>
                          <div>
                            <h5 className="text-sm font-semibold text-white group-hover:text-[#007acc]">
                              {app.displayName}
                            </h5>
                            <p className="text-xs text-[#858585]">{app.type}</p>
                          </div>
                        </div>
                        <div className={`w-2 h-2 rounded-full ${
                          app.status === 'active' ? 'bg-green-500' :
                          app.status === 'inactive' ? 'bg-red-500' :
                          'bg-yellow-500'
                        }`} />
                      </div>
                      
                      <p className="text-xs text-[#cccccc] mb-3 line-clamp-2">
                        {app.description}
                      </p>

                      <div className="flex items-center gap-2 mb-3">
                        {app.tags.slice(0, 3).map(tag => (
                          <span
                            key={tag}
                            className="text-xs px-2 py-1 bg-[#3c3c3c] rounded text-[#858585]"
                          >
                            {tag}
                          </span>
                        ))}
                      </div>

                      <div className="flex gap-2">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleLaunchApp(app);
                          }}
                          className="flex-1 flex items-center justify-center gap-2 px-3 py-2 bg-[#0e639c] hover:bg-[#1177bb] text-white text-xs rounded transition-colors"
                        >
                          <Play className="w-3 h-3" />
                          Launch
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleOpenFolder(app);
                          }}
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
              <p>No apps found matching your criteria</p>
            </div>
          )}
        </div>
      </div>

      {/* App Detail Panel */}
      {selectedApp && (
        <div className="w-96 border-l border-[#2d2d2d] bg-[#252526] overflow-y-auto">
          <div className="p-4 border-b border-[#2d2d2d] flex items-center justify-between">
            <h3 className="text-sm font-semibold text-white">App Details</h3>
            <button
              onClick={() => setSelectedApp(null)}
              className="text-[#858585] hover:text-white"
            >
              ✕
            </button>
          </div>
          
          <div className="p-4 space-y-4">
            <div className="flex items-center gap-3">
              <span className="text-4xl">{selectedApp.icon}</span>
              <div>
                <h4 className="text-lg font-semibold text-white">{selectedApp.displayName}</h4>
                <p className="text-xs text-[#858585]">{selectedApp.name}</p>
              </div>
            </div>

            <div>
              <label className="text-xs text-[#858585] uppercase">Description</label>
              <p className="text-sm text-[#cccccc] mt-1">{selectedApp.description}</p>
            </div>

            <div>
              <label className="text-xs text-[#858585] uppercase">Type</label>
              <p className="text-sm text-white mt-1">{selectedApp.type}</p>
            </div>

            <div>
              <label className="text-xs text-[#858585] uppercase">Category</label>
              <p className="text-sm text-white mt-1">
                {CATEGORIES.find(c => c.id === selectedApp.category)?.name}
              </p>
            </div>

            <div>
              <label className="text-xs text-[#858585] uppercase">Status</label>
              <div className="flex items-center gap-2 mt-1">
                <div className={`w-2 h-2 rounded-full ${
                  selectedApp.status === 'active' ? 'bg-green-500' :
                  selectedApp.status === 'inactive' ? 'bg-red-500' :
                  'bg-yellow-500'
                }`} />
                <span className="text-sm text-white capitalize">{selectedApp.status}</span>
              </div>
            </div>

            <div>
              <label className="text-xs text-[#858585] uppercase">Path</label>
              <p className="text-xs text-[#cccccc] mt-1 font-mono bg-[#1e1e1e] p-2 rounded break-all">
                {selectedApp.path}
              </p>
            </div>

            {selectedApp.url && (
              <div>
                <label className="text-xs text-[#858585] uppercase">URL</label>
                <a
                  href={selectedApp.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-[#007acc] hover:underline mt-1 block"
                >
                  {selectedApp.url}
                </a>
              </div>
            )}

            {selectedApp.port && (
              <div>
                <label className="text-xs text-[#858585] uppercase">Port</label>
                <p className="text-sm text-white mt-1">{selectedApp.port}</p>
              </div>
            )}

            {selectedApp.devCommand && (
              <div>
                <label className="text-xs text-[#858585] uppercase">Dev Command</label>
                <p className="text-xs text-[#cccccc] mt-1 font-mono bg-[#1e1e1e] p-2 rounded">
                  {selectedApp.devCommand}
                </p>
              </div>
            )}

            {selectedApp.buildCommand && (
              <div>
                <label className="text-xs text-[#858585] uppercase">Build Command</label>
                <p className="text-xs text-[#cccccc] mt-1 font-mono bg-[#1e1e1e] p-2 rounded">
                  {selectedApp.buildCommand}
                </p>
              </div>
            )}

            <div>
              <label className="text-xs text-[#858585] uppercase">Tags</label>
              <div className="flex flex-wrap gap-2 mt-2">
                {selectedApp.tags.map(tag => (
                  <span
                    key={tag}
                    className="text-xs px-2 py-1 bg-[#3c3c3c] rounded text-[#cccccc]"
                  >
                    {tag}
                  </span>
                ))}
              </div>
            </div>

            <div className="pt-4 space-y-2">
              <button
                onClick={() => handleLaunchApp(selectedApp)}
                className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-[#0e639c] hover:bg-[#1177bb] text-white text-sm rounded transition-colors"
              >
                <Play className="w-4 h-4" />
                Launch Application
              </button>
              <button
                onClick={() => handleOpenFolder(selectedApp)}
                className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-[#3c3c3c] hover:bg-[#505050] text-white text-sm rounded transition-colors"
              >
                <Folder className="w-4 h-4" />
                Copy Path to Clipboard
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
