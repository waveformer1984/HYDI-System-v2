# ProtoForge → Execution + Revenue Layer (Kilo Node)

[![Unit Tests](https://github.com/waveformer1984/HYDI-System-v2/actions/workflows/unit-tests.yml/badge.svg)](https://github.com/waveformer1984/HYDI-System-v2/actions/workflows/unit-tests.yml)
[![CodeQL](https://github.com/waveformer1984/HYDI-System-v2/actions/workflows/codeql.yml/badge.svg)](https://github.com/waveformer1984/HYDI-System-v2/actions/workflows/codeql.yml)
[![codecov](https://codecov.io/gh/waveformer1984/HYDI-System-v2/branch/clean-main/graph/badge.svg)](https://codecov.io/gh/waveformer1984/HYDI-System-v2)
![Node](https://img.shields.io/badge/node-%3E%3D20-brightgreen)
![License](https://img.shields.io/badge/license-private-lightgrey)

This system turns ProtoForge into an executable, monetizable system by managing infrastructure, syncing code and modules, handling event persistence, and enabling revenue-capable endpoints.

## Features

- Repository & file system control
- Module execution pipeline
- Cascade bridge for bidirectional communication
- Supabase integration for event persistence
- Revenue-ready endpoints (/process, /insight, /event)
- Basic monetization hooks (usage tracking)
- System health & metrics endpoints
- End-to-end testing capabilities

## Getting Started

1. Install dependencies:
   ```bash
   npm install
   ```

2. Set up environment variables in `.env`:
   ```
   SUPABASE_URL=your_supabase_url
   SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
   ```

3. Run the system:
   ```bash
   npm start
   ```

4. Run tests:
   ```bash
   node test-system.js
   ```

## API Endpoints

- `GET /health` - System health check
- `POST /process` - Accept payload and trigger processing
- `GET /insight` - Get processed intelligence
- `POST /event` - Log system events

## Project Structure

- `src/server.js` - Main Express server
- `kilo.js` - Kilo execution engine with Cascade bridge
- `modules/` - Custom modules directory
- `kilo/modules/` - Built-in Kilo modules
- `supabase/migrations/` - Database schema
- `knowledge_base/` - Shared knowledge storage

## Success Criteria

- API responds correctly
- Events persist to Supabase
- Cascade communication works
- Module execution pipeline functions
- System health metrics available
