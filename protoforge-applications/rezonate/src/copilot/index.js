'use strict';

/**
 * Rezonate Co-Pilot — the creative layer that sits inside Rezonate, not
 * beside it. It reads real project state (tracks, stems, jobs, exports),
 * turns that awareness into actionable suggestions, and remembers the
 * session so unfinished ideas survive restarts.
 *
 * Everything it proposes is a normal /processing/jobs payload — the human
 * approves every operation; suggestions never apply themselves. All
 * reasoning is local and deterministic: no cloud, no LLM required.
 */

const fs = require('fs');
const path = require('path');

const SUGGESTION_KINDS = ['stems', 'analyze', 'segment_swap', 'generate', 'export', 'next'];

function _memoryFile(dataDir, projectId) {
  return path.join(dataDir, 'copilot', `${projectId || 'default'}.jsonl`);
}

function createCopilot({ repository, engine, dataDir, now = () => new Date() } = {}) {
  const dir = dataDir || (repository && repository.dataDir) || '.';

  // Repository methods are synchronous today, may be async later — accept
  // either, and degrade to empty context when the store is unreadable.
  async function _safe(fn, fallback) {
    try { return await Promise.resolve(fn()).catch(() => fallback); }
    catch { return fallback; }
  }

  async function context(projectId) {
    const project = projectId && repository ? await _safe(() => repository.getProject(projectId), null) : null;
    const tracks = repository && projectId ? await _safe(() => repository.listTracks(projectId), []) : [];
    const assets = repository ? await _safe(() => repository.listAssets(projectId), []) : [];
    const jobs = repository ? await _safe(() => repository.listProcessingJobs(), []) : [];
    return { project, tracks, assets, jobs, engineStatus: engine && engine.status ? engine.status() : null, at: now().toISOString() };
  }

  function _suggestFrom(ctx) {
    const out = [];
    const tracks = ctx.tracks || [];
    const assets = ctx.assets || [];
    const jobs = (ctx.jobs || []).slice().sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));

    const unanalyzed = assets.filter((a) => a && a.file_path && !a.bpm && a.type !== 'stem');
    if (unanalyzed.length) {
      const a = unanalyzed[0];
      out.push({
        kind: 'analyze', title: 'Analyze tempo & key',
        detail: `${path.basename(a.file_path)} has no BPM/key yet. Tag it so future swaps land on-grid.`,
        action: { task_type: 'analyze', source_path: a.file_path },
      });
    }

    const stemless = tracks.filter((t) => t && t.source_path && !(t.stems_dir || (t.metadata || {}).stemsDir));
    if (stemless.length) {
      const t = stemless[0];
      out.push({
        kind: 'stems', title: 'Split stems (Demucs, CPU)',
        detail: `${t.title || path.basename(t.source_path)} has no stems yet — one slow pass unlocks every remix op.`,
        action: { task_type: 'stems', source_path: t.source_path },
      });
    }

    const withStems = tracks.filter((t) => t && (t.stems_dir || (t.metadata || {}).stemsDir));
    if (withStems.length) {
      const t = withStems[0];
      const stemsDir = t.stems_dir || t.metadata.stemsDir;
      const bpm = t.bpm || (t.metadata || {}).bpm;
      const ideas = [
        { stem: 'drums', bars: '4-8', label: 'drum fill' },
        { stem: 'bass', bars: '1-4', label: 'bass intro variation' },
        { stem: 'vocals', bars: '9-12', label: 'vocal phrase swap' },
      ];
      for (const idea of ideas.slice(0, 2)) {
        out.push({
          kind: 'segment_swap', title: `Try a ${idea.label} on ${t.title || 'the track'}`,
          detail: `Swap ${idea.stem} bars ${idea.bars} — reversible, renders to swaps/.`,
          action: {
            task_type: 'segment_swap',
            metadata: { stemsDir, stem: idea.stem, bars: idea.bars, segmentBars: 1, samples: idea.stem, maxReplacements: 4, ...(bpm ? { bpm } : {}) },
          },
        });
      }
    }

    const lastJob = jobs[0];
    if (lastJob && lastJob.state === 'failed') {
      out.push({
        kind: 'next', title: 'Unblock the last job',
        detail: `Job ${lastJob.id.slice(0, 8)} failed${lastJob.error ? `: ${String(lastJob.error).slice(0, 80)}` : ''}. Retry or adjust its inputs.`,
      });
    } else if (!out.length && lastJob && lastJob.state === 'completed') {
      out.push({
        kind: 'export', title: 'Package the latest render',
        detail: `Latest job finished ${lastJob.updated_at || lastJob.created_at}. Export it into the project.`,
      });
    }

    if (!out.length) {
      out.push({
        kind: 'generate', title: 'Sketch a new idea',
        detail: 'Nothing queued — generate a short clip to start from.',
        action: { task_type: 'generate', prompt: 'a quiet intro idea', clip: true },
      });
    }
    return out.slice(0, 5);
  }

  async function suggest(projectId) {
    const ctx = await context(projectId);
    return { project_id: projectId || null, at: now().toISOString(), suggestions: _suggestFrom(ctx), context: { tracks: ctx.tracks.length, assets: ctx.assets.length, jobs: ctx.jobs.length } };
  }

  async function remember(projectId, note) {
    const file = _memoryFile(dir, projectId);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const row = { at: now().toISOString(), note: String(note || '').slice(0, 2000) };
    fs.appendFileSync(file, JSON.stringify(row) + '\n');
    return row;
  }

  async function memory(projectId, limit = 50) {
    const file = _memoryFile(dir, projectId);
    try {
      const lines = fs.readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).slice(-limit);
      return { project_id: projectId || null, entries: lines.map((l) => { try { return JSON.parse(l); } catch { return { note: l }; } }) };
    } catch { return { project_id: projectId || null, entries: [] }; }
  }

  return { context, suggest, remember, memory, SUGGESTION_KINDS };
}

module.exports = { createCopilot, SUGGESTION_KINDS };
