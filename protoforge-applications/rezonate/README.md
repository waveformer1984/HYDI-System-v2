# Resonate ProtoForge Application

A ProtoForge-native wrapper around the existing `rezonate/` audio engine.

## Purpose

Resonate is the first ProtoForge application that organizes an existing, working system instead of rebuilding it. The existing Python audio pipeline remains the source of truth for generation, stem separation, and analysis. This application provides:

- project, track, and asset orchestration
- validation and error boundaries
- domain events
- audio engine adapter
- diagnostics
- health endpoints

## Architecture

```text
Existing Resonate Engine
          |
          v
   Resonate Adapter
          |
          v
ProtoForge Resonate Application
          |
          +------------+
          |            |
       Events       Ownership
          |
          v
      HYDI (future)
```

## Relationship to existing systems

- `rezonate/` — owned by the audio engine; the adapter calls it.
- `supabase/migrations/20260522000001_rezonate_schema.sql` — schema baseline; the local repository mirrors it.
- `apps/ursula-frontend/...` and `pages/song-composer.tsx` — legacy/experimental frontends; not merged.

## Adapter design

`src/adapters/resonate-engine.js` provides the boundary:

```javascript
{
  generateSong(),
  createStems(),
  analyzeAudio(),
  getProcessingStatus()
}
```

The adapter does not contain DSP logic. It delegates to the existing Python scripts.

## Development commands

```bash
npm install
npm test
npm start
```

## Status

This is the canonical ProtoForge Resonate foundation. Domain behavior will be added in later phases.
