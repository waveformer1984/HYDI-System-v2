# Ursula hub panels & workspaces

## Hub panels

Source of truth: `config/portfolio.json`. Ursula fetches via `/api/portfolio` (`apps/ursula-frontend/src/lib/portfolio.ts`).

Each app entry drives:

- Launch target (PM2 name + port)
- Health URL for status chips
- Embed pane URL for in-hub iframes

## Persistent Heidi chat

Implemented — see `docs/URSULA_HEIDI_PANEL.md` (`HeidiChatPanel.tsx` in layout).

## Workspace templates

`config/workspaces.template.json` defines three starter workspaces:

| ID | Apps |
|----|------|
| `rezonate` | Rezonate + song composer |
| `lead-gen` | Lead Forge |
| `proto-iy` | Proto.I.Y (`:3010` when salvage PR merges) |

Jordan copies rows into portfolio or Ursula consolidation map (`workspace-consolidation.ts`).

## Verification (cloud agent)

- Unit: Ursula vitest not run in this VM (no full apps build).
- Jordan: open `http://127.0.0.1:3100` on Frank, confirm portfolio cards + Heidi panel.
