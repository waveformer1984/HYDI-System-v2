/**
 * /trace-viewer
 * Visual pipeline trace debugger — HEIDI V2 "timeline instead of log archaeology"
 */

import { useState, useEffect, useCallback } from 'react';

const STAGE_LABELS = {
  ingestion: 'Ingestion',
  raw_ledger: 'RAW LEDGER ⦿',
  cascade: 'CASCADE',
  kilo: 'KILO',
  protoforge: 'ProtoForge',
  emission: 'Emission',
};

const STATUS_COLOR = {
  completed: '#10b981',
  active: '#3b82f6',
  pending: '#4b5563',
  failed: '#ef4444',
};

function StageNode({ stage }) {
  const color = STATUS_COLOR[stage.status] || STATUS_COLOR.pending;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', minWidth: 86 }}>
      <div
        style={{
          width: 34, height: 34, borderRadius: '50%', background: color,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 14, color: '#fff', fontWeight: 700, flexShrink: 0,
        }}
      >
        {stage.status === 'completed' ? '✓' : stage.status === 'active' ? '●' : '○'}
      </div>
      <div style={{ fontSize: 9, color: '#9ca3af', marginTop: 4, textAlign: 'center', lineHeight: 1.2 }}>
        {STAGE_LABELS[stage.name] || stage.name}
      </div>
      {stage.metadata?.classification && (
        <div style={{ fontSize: 8, color: '#6b7280', textAlign: 'center', maxWidth: 80 }}>
          {stage.metadata.classification}
        </div>
      )}
    </div>
  );
}

function TraceRow({ trace, selected, onClick }) {
  return (
    <div
      onClick={onClick}
      style={{
        padding: '10px 16px', borderBottom: '1px solid #1f2937',
        cursor: 'pointer', background: selected ? '#1f2937' : 'transparent',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
        <span style={{ fontSize: 12, color: '#e5e7eb', fontFamily: 'monospace' }}>
          {trace.type}
        </span>
        <span style={{ fontSize: 10, color: '#6b7280' }}>
          {new Date(trace.occurredAt).toLocaleTimeString()}
        </span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 0 }}>
        {trace.stages.map((stage, i) => (
          <div key={stage.name} style={{ display: 'flex', alignItems: 'center' }}>
            <StageNode stage={stage} />
            {i < trace.stages.length - 1 && (
              <div
                style={{
                  width: 18, height: 2, flexShrink: 0,
                  background: stage.status === 'completed' ? '#10b981' : '#374151',
                }}
              />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function DetailPanel({ trace }) {
  if (!trace) {
    return (
      <div style={{ color: '#6b7280', fontSize: 13, textAlign: 'center', paddingTop: 80 }}>
        Select an event to inspect its pipeline stages
      </div>
    );
  }
  return (
    <div>
      <h2 style={{ margin: '0 0 14px', fontSize: 15, color: '#f9fafb' }}>{trace.type}</h2>
      <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse', marginBottom: 20 }}>
        <tbody>
          {[
            ['Event ID', trace.eventId],
            ['Source', trace.source || '—'],
            ['Severity', trace.severity || '—'],
            ['Status', trace.processed ? 'processed' : 'pending'],
            ['Time', new Date(trace.occurredAt).toLocaleString()],
          ].map(([label, value]) => (
            <tr key={label}>
              <td style={{ padding: '5px 0', color: '#9ca3af', width: 80 }}>{label}</td>
              <td style={{ padding: '5px 0', fontFamily: 'monospace', color: '#e5e7eb' }}>{value}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div style={{ fontSize: 11, color: '#6b7280', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 10 }}>
        Pipeline Stages
      </div>
      {trace.stages.map(stage => (
        <div
          key={stage.name}
          style={{
            padding: '9px 12px', marginBottom: 6, borderRadius: 6,
            background: '#1f2937',
            borderLeft: `3px solid ${STATUS_COLOR[stage.status] || STATUS_COLOR.pending}`,
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontWeight: 600, fontSize: 12 }}>
              {STAGE_LABELS[stage.name] || stage.name}
            </span>
            <span
              style={{
                fontSize: 10, textTransform: 'uppercase',
                color: STATUS_COLOR[stage.status] || STATUS_COLOR.pending,
              }}
            >
              {stage.status}
            </span>
          </div>
          {stage.metadata && (
            <pre style={{ margin: '6px 0 0', fontSize: 10, color: '#9ca3af', fontFamily: 'monospace' }}>
              {JSON.stringify(stage.metadata, null, 2)}
            </pre>
          )}
        </div>
      ))}
    </div>
  );
}

export default function TraceViewer() {
  const [traces, setTraces] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [filter, setFilter] = useState('');

  const fetchTraces = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/traces?limit=50');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setTraces(data.traces || []);
      setError(null);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchTraces(); }, [fetchTraces]);

  useEffect(() => {
    if (!autoRefresh) return;
    const id = setInterval(fetchTraces, 5000);
    return () => clearInterval(id);
  }, [autoRefresh, fetchTraces]);

  const visible = filter
    ? traces.filter(t => t.type.toLowerCase().includes(filter.toLowerCase()))
    : traces;
  const selected = traces.find(t => t.id === selectedId) || null;

  return (
    <div style={{ background: '#111827', minHeight: '100vh', color: '#e5e7eb', fontFamily: 'system-ui,sans-serif' }}>
      <div style={{ padding: '14px 20px', borderBottom: '1px solid #1f2937', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>Pipeline Trace Debugger</h1>
          <p style={{ margin: '2px 0 0', fontSize: 11, color: '#6b7280' }}>
            HEIDI V2 · Ingestion → RAW LEDGER → CASCADE → KILO → ProtoForge → Emission
          </p>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <input
            placeholder="Filter events…"
            value={filter}
            onChange={e => setFilter(e.target.value)}
            style={{ background: '#1f2937', border: '1px solid #374151', borderRadius: 5, padding: '5px 10px', color: '#e5e7eb', fontSize: 12, width: 180 }}
          />
          <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, cursor: 'pointer' }}>
            <input type="checkbox" checked={autoRefresh} onChange={e => setAutoRefresh(e.target.checked)} />
            Auto
          </label>
          <button
            onClick={fetchTraces}
            disabled={loading}
            style={{ background: '#2563eb', border: 'none', borderRadius: 5, padding: '5px 12px', color: '#fff', cursor: 'pointer', fontSize: 12 }}
          >
            {loading ? '…' : 'Refresh'}
          </button>
        </div>
      </div>

      <div style={{ display: 'flex', height: 'calc(100vh - 65px)' }}>
        <div style={{ width: '58%', overflowY: 'auto', borderRight: '1px solid #1f2937' }}>
          {error && <div style={{ padding: 14, color: '#ef4444', fontSize: 12 }}>Error: {error}</div>}
          {visible.length === 0 && !loading && (
            <div style={{ padding: 24, color: '#6b7280', fontSize: 12, textAlign: 'center' }}>
              No events found. Events appear as they flow through the pipeline.
            </div>
          )}
          {visible.map(trace => (
            <TraceRow
              key={trace.id}
              trace={trace}
              selected={selectedId === trace.id}
              onClick={() => setSelectedId(trace.id)}
            />
          ))}
        </div>
        <div style={{ flex: 1, overflowY: 'auto', padding: 18 }}>
          <DetailPanel trace={selected} />
        </div>
      </div>
    </div>
  );
}
