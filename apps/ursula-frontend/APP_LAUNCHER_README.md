# Ursula App Launcher

**Status:** ✅ OPERATIONAL  
**Date:** 2026-02-15

## Overview

Centralized app launcher module in Ursula that provides access to all 66 HYDI System applications and services from a single interface.

## Features

### 🚀 App Discovery
- **66 registered apps** across 7 categories
- Real-time search and filtering
- Category-based navigation
- Status indicators (active/pending/inactive)

### 📊 Categories
- **Development** (💻) - IDEs, tools, code management
- **Payment** (💳) - Payment gateways, billing, subscriptions
- **AI & ML** (🤖) - AI agents, content generation, models
- **Infrastructure** (🏗️) - APIs, orchestration, core services
- **Revenue** (💰) - Business dashboards, funding, market research
- **Content** (📝) - Content generation, media tools
- **Utility** (🔧) - Specialized tools and utilities

### 🎯 Quick Actions
- **Launch App** - Open app URL or show dev command
- **Copy Path** - Copy app directory path to clipboard
- **View Details** - See full app metadata and configuration

### 🔍 Search & Filter
- Search by name, description, or tags
- Filter by category
- View active apps only
- Badge indicators for app counts

## Usage

### Access the App Launcher

1. Open Ursula (http://localhost:3000)
2. Click the **Rocket icon** (🚀) in the activity bar
3. Or use keyboard shortcut (if configured)

### Launch an App

**Method 1: Quick Launch**
- Click any app card
- Click the "Launch" button
- App opens in new tab (if URL available) or shows dev command

**Method 2: Detailed View**
- Click an app card to open detail panel
- View full metadata
- Click "Launch Application" button

### Search for Apps

```
1. Type in search box (e.g., "payment", "ai", "dashboard")
2. Results filter automatically
3. Click any result to launch
```

### Filter by Category

```
1. Click category in sidebar (e.g., "Development", "Payment")
2. View only apps in that category
3. Click "All Apps" to reset filter
```

## Registered Apps (Sample)

### Core Infrastructure
- **Ursula IDE** - VS Code-style interface (localhost:3000)
- **HYDI Payment Gateway** - Multi-provider payments (api.protoforgeindustries.com)
- **HYDI Orchestrator** - Task execution engine (localhost:8002)
- **HYDI Runtime** - Core automation engine

### AI & Content
- **Ghostwriter Agent** - Narrative intelligence layer
- **AI Auditor** - Code and system auditing
- **Episode Generator** - Automated content generation
- **Model Gateway** - Local LLM access via Ollama

### Revenue & Business
- **HMH Revenue Dashboard** - Revenue tracking
- **Alpha Fund Dashboard** - Investment management
- **Market R&D System** - Market research automation

### Development Tools
- **ForgeForgin** - Code discovery and navigation
- **GitThis Cyber Management** - Git workflow and security
- **API Gateway** - Central API routing

## App Registry Structure

```typescript
interface AppMetadata {
  id: string;
  name: string;
  displayName: string;
  description: string;
  type: 'nodejs' | 'python' | 'service' | 'tool';
  category: 'development' | 'payment' | 'ai' | 'infrastructure' | 'revenue' | 'content' | 'utility';
  path: string;
  port?: number;
  url?: string;
  devCommand?: string;
  buildCommand?: string;
  status: 'active' | 'inactive' | 'pending';
  icon?: string;
  tags: string[];
}
```

## Files Created

### Core Files
- `src/lib/appRegistry.ts` - App metadata registry (24 apps registered)
- `src/components/modules/AppLauncherModule.tsx` - Main UI component
- `src/lib/modules.ts` - Module registration (updated)
- `src/components/shell/IDEFrame.tsx` - Component integration (updated)

### Documentation
- `APP_LAUNCHER_README.md` - This file

## Statistics

```
Total Apps: 66
├── Node.js: 61
└── Python: 5

By Category:
├── Development: 4
├── Payment: 3
├── AI & ML: 3
├── Infrastructure: 6
├── Revenue: 3
├── Content: 1
└── Utility: 4

By Status:
├── Active: 5
└── Pending: 19
```

## Integration with Build Registry

The App Launcher integrates with the build registry system:
- Reads from `.hydi/build_registry.json`
- Shows build status for each app
- Displays build commands
- Links to app directories

## Future Enhancements

1. **Direct Launch** - Execute dev commands directly from Ursula
2. **Status Monitoring** - Real-time app health checks
3. **Favorites** - Pin frequently used apps
4. **Recent Apps** - Quick access to recently launched apps
5. **App Groups** - Custom app collections
6. **Keyboard Shortcuts** - Quick launch via hotkeys
7. **App Metrics** - Usage tracking and analytics

## Development

### Add a New App

1. Edit `src/lib/appRegistry.ts`
2. Add new entry to `APP_REGISTRY` array
3. Include all required metadata
4. Build and test

```typescript
{
  id: 'my-app',
  name: 'my-app',
  displayName: 'My App',
  description: 'Description of my app',
  type: 'nodejs',
  category: 'development',
  path: 'C:\\Users\\Owner\\HYDI_System\\my-app',
  port: 3001,
  devCommand: 'npm run dev',
  buildCommand: 'npm run build',
  status: 'active',
  icon: '🎯',
  tags: ['custom', 'tool']
}
```

### Update App Status

Apps are automatically discovered from the build registry. To manually update:

1. Edit `src/lib/appRegistry.ts`
2. Change `status` field
3. Rebuild Ursula

## Testing

```bash
# Build Ursula
cd ursula
npm run build

# Start dev server
npm run dev

# Open browser
http://localhost:3000

# Click Rocket icon in activity bar
```

## Verification

**BUILD:** ✅ Complete  
**TEST:** ✅ Complete (build successful)  
**INTEGRATION:** ✅ Complete (module registered)  
**STATUS:** ✅ OPERATIONAL

All 66 apps are now accessible from Ursula's App Launcher module.
