import React, { useState, useCallback } from 'react';
import { MidiDevice } from './MidiControllerInterface';

interface MidiMapping {
  key: string;
  action: string;
  value?: number;
  label: string;
}

interface Props {
  supported: boolean;
  connected: boolean;
  devices: MidiDevice[];
  lastAction: string | null;
  mapping: Record<string, MidiMapping>;
  onConnect: () => void;
  onLearnPad: (sectionIndex: number, sectionName: string) => Promise<void>;
  sections: { id: string; name: string }[];
}

export default function MidiStatusBar({
  supported, connected, devices, lastAction, mapping, onConnect, onLearnPad, sections,
}: Props) {
  const [showMapping, setShowMapping] = useState(false);
  const [learning, setLearning] = useState<{ index: number; name: string } | null>(null);

  const inputs = devices.filter((d) => d.type === 'input');

  const handleLearn = useCallback(async (index: number, name: string) => {
    setLearning({ index, name });
    try {
      await onLearnPad(index, name);
    } finally {
      setLearning(null);
    }
  }, [onLearnPad]);

  if (!supported) {
    return (
      <div className="flex items-center gap-2 text-xs text-yellow-500 bg-yellow-950/30 px-3 py-1.5 rounded-lg">
        <span>⚠</span>
        <span>Web MIDI not supported in this browser — use Chrome or Edge</span>
      </div>
    );
  }

  return (
    <div className="relative">
      {/* Status pill */}
      <button
        onClick={connected ? () => setShowMapping((v) => !v) : onConnect}
        className={`flex items-center gap-2 text-xs px-3 py-1.5 rounded-lg border transition-colors ${
          connected
            ? 'bg-teal-950/40 border-teal-800 text-teal-300 hover:bg-teal-900/40'
            : 'bg-gray-900 border-gray-700 text-gray-400 hover:border-gray-500'
        }`}
      >
        <span className={`w-2 h-2 rounded-full ${connected ? 'bg-teal-400 animate-pulse' : 'bg-gray-600'}`} />
        {connected ? (
          <>
            MIDI · {inputs.length} device{inputs.length !== 1 ? 's' : ''}
            {lastAction && <span className="text-teal-500 ml-1">· {lastAction}</span>}
          </>
        ) : (
          'Connect MIDI'
        )}
        {connected && <span className="ml-1 text-teal-600">{showMapping ? '▲' : '▼'}</span>}
      </button>

      {/* Mapping panel */}
      {showMapping && connected && (
        <div className="absolute right-0 top-9 z-40 w-80 bg-gray-950 border border-gray-700 rounded-xl shadow-2xl overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-800">
            <h3 className="text-sm font-semibold text-white">MIDI Mapping</h3>
            <p className="text-xs text-gray-400 mt-0.5">DDJ-SB3 hot cues A1–A8 jump to sections 1–8 by default. Press "Learn" to remap any pad.</p>
          </div>

          {/* Connected devices */}
          <div className="px-4 py-2 border-b border-gray-800/50">
            {inputs.map((d) => (
              <div key={d.id} className="flex items-center gap-2 text-xs text-gray-300 py-1">
                <span className="w-1.5 h-1.5 rounded-full bg-teal-400" />
                {d.name}
                <span className="ml-auto text-gray-600 capitalize">{d.state}</span>
              </div>
            ))}
          </div>

          {/* Section → pad mappings */}
          <div className="px-4 py-3">
            <p className="text-xs text-gray-500 mb-2 uppercase tracking-wider">Section pad mapping</p>
            <div className="space-y-1.5 max-h-48 overflow-y-auto">
              {sections.slice(0, 8).map((sec, i) => {
                const isLearning = learning?.index === i;
                return (
                  <div key={sec.id} className="flex items-center gap-2 text-xs">
                    <span className="text-gray-600 font-mono w-4">{i + 1}</span>
                    <span className="text-gray-300 flex-1 truncate">{sec.name}</span>
                    <button
                      onClick={() => handleLearn(i, sec.name)}
                      disabled={!!learning}
                      className={`px-2 py-0.5 rounded text-xs transition-colors ${
                        isLearning
                          ? 'bg-yellow-600 text-white animate-pulse'
                          : 'bg-gray-800 text-gray-400 hover:bg-gray-700 disabled:opacity-40'
                      }`}
                    >
                      {isLearning ? 'Press pad…' : 'Learn'}
                    </button>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Current mapping table */}
          <div className="px-4 pb-3 border-t border-gray-800/50 pt-2">
            <p className="text-xs text-gray-500 mb-2 uppercase tracking-wider">Active mappings</p>
            <div className="space-y-1 max-h-28 overflow-y-auto">
              {Object.values(mapping).slice(0, 12).map((m) => (
                <div key={m.key} className="flex items-center gap-2 text-xs text-gray-400">
                  <span className="font-mono text-gray-600 w-16 truncate">{m.key}</span>
                  <span className="text-gray-300 truncate">{m.label}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
