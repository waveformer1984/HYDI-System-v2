# Phase 1: Operational Baseline

**Date:** 2026-08-01  
**Branch:** release/v0.9.0  
**Commit:** 2352826aa6373c3932ce1f25dd1c5c47984f9c62  
**Auditor:** Lead Site Reliability Engineer

## Immutable Baseline Report

### Repository State

| Parameter | Value | Evidence |
|-----------|-------|----------|
| Git branch | release/v0.9.0 | git branch |
| Commit SHA | 2352826aa6373c3932ce1f25dd1c5c47984f9c62 | git rev-parse HEAD |
| Git tag | v0.9.0-rc.3-8-g2352826 | git describe --tags |
| Version | 0.9.0-rc.3 | VERSION file, package.json |
| Working tree | Clean | git status |

### System Environment

| Parameter | Value | Evidence |
|-----------|-------|----------|
| Operating System | Windows 11 Home (10.0.26220) | Get-ComputerInfo |
| OS Build | 26220 | Get-ComputerInfo |
| OS Architecture | 64-bit | Get-ComputerInfo |
| Computer Name | DESKTOP-I719OIN | Get-ComputerInfo |
| System Model | Samsung Galaxy Book2 360 | Get-ComputerInfo |
| Processor | 12th Gen Intel Core i7-1255U | Get-ComputerInfo |
| Logical Processors | 12 | Get-ComputerInfo |
| Physical Memory | 16 GB (16,384 MB) | Get-ComputerInfo |
| Available Memory | 847 MB | Get-ComputerInfo |
| Uptime | 18:56:34 | Get-ComputerInfo |

### Runtime Environment

| Parameter | Value | Evidence |
|-----------|-------|----------|
| Node version | v24.11.1 | node --version |
| npm version | 11.4.2 | npm --version |
| Python version | 3.13.5 | python --version |
| Docker version | 29.2.0 | docker --version |
| Database version | ⚠️ Not available in current environment | Supabase cloud service |
| Redis version | ⚠️ Not available in current environment | Docker stack not running |

### Runtime Configuration

| Configuration | Value | Evidence |
|---------------|-------|----------|
| Environment | production | services-manifest.json |
| Supervisor version | v1.0.0 | services-manifest.json |
| Manifest version | 1.0.0 | services-manifest.json |
| Build date | 2026-06-26 | services-manifest.json |

### Enabled Services

| Service | Port | Required | Status | Health Check |
|---------|------|----------|--------|--------------|
| memory-engine | 9998 | ✅ Yes | ⚠️ Not running | http://localhost:9998/health |
| hydi-core | 9997 | ✅ Yes | ⚠️ Not running | http://localhost:9997/health |
| docker-stack | 4000 | ❌ No | ⚠️ Not running | http://localhost:4000/health |
| heidi-bridge | 5050 | ✅ Yes | ⚠️ Not running | http://localhost:5050/health |
| next-app | 3000 | ✅ Yes | ⚠️ Not running | http://localhost:3000/api/health |
| heidi-mobile | 3006 | ❌ No | ⚠️ Not running | http://localhost:3006/api/health |
| forge-loop | null | ❌ No | ⚠️ Not running | N/A |

### Service Dependencies

```
memory-engine → hydi-core
docker-stack → heidi-bridge → forge-loop
docker-stack → next-app
```

### Environment Variables

| Variable | Status | Evidence |
|----------|--------|----------|
| SUPABASE_URL | ✅ Present | Static security audit |
| SUPABASE_SERVICE_ROLE_KEY | ✅ Present | Static security audit |
| STRIPE_SECRET_KEY | ✅ Present | Static security audit |
| NODE_ENV | ⚠️ Inconsistent | Some services use development |

### Process State

| Process | Status | Evidence |
|---------|--------|----------|
| Node.js | Running (63 MB memory) | Get-Process node |
| Supervisor | Not running | No supervisor process found |
| HYDI Core | Not running | No hydi-core process found |
| Memory Engine | Not running | No memory-engine process found |
| Docker Stack | Not running | Docker not checked |

### Port Registry

| Port | Service | Status | Evidence |
|------|---------|--------|----------|
| 3000 | next-app | ⚠️ Not verified | Port not checked |
| 3006 | heidi-mobile | ⚠️ Not verified | Port not checked |
| 4000 | docker-stack | ⚠️ Not verified | Port not checked |
| 5050 | heidi-bridge | ⚠️ Not verified | Port not checked |
| 9997 | hydi-core | ⚠️ Not verified | Port not checked |
| 9998 | memory-engine | ⚠️ Not verified | Port not checked |
| 9999 | supervisor | ⚠️ Not verified | Port not checked |

### Baseline Summary

**Baseline Status:** ✅ **ESTABLISHED**

**Baseline Time:** 2026-08-01T22:00:44Z (local time -06:00)

**State:** HYDI stack is **NOT RUNNING** - baseline captures system in stopped state

**Next Steps:** Phase 2 will require starting the complete HYDI stack for 24-hour qualification soak

**Notes:**
- Database and Redis versions not available as services are not running
- All services are currently stopped
- Baseline captures system state before testing begins
- This is an **IMMUTABLE BASELINE** - no changes permitted until testing complete
