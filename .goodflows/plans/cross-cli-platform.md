# Cross-CLI Platform Plan: Claude + Gemini Collaboration

## Overview

Enable different LLMs (Claude Code, Gemini, GPT-4, etc.) to work on the same codebase with shared context. Claude handles backend, Gemini handles frontend - both share state via GoodFlows.

## Current State (Already Exists)

### Handoff Tools Available

| Tool | Purpose |
|------|---------|
| `goodflows_export_handoff` | Export full context as JSON |
| `goodflows_import_handoff` | Import context from another LLM |
| `goodflows_generate_resume_prompt` | Generate prompt for another LLM |
| `goodflows_session_resume` | Resume existing session |

### What Works Today

```
Claude Code                         Gemini CLI
    │                                   │
    ├── goodflows_export_handoff()      │
    │         │                         │
    │         └──→ handoff.json ───────→│
    │                                   ├── goodflows_import_handoff()
    │                                   │
    │         ┌──────────────────────────┤
    │         │                         │
    ├── goodflows_session_resume() ←────┘
```

## Proposed Architecture

### Option A: File-Based Sync (Simplest)

```
.goodflows/
  ├── sync/
  │   ├── handoff-claude.json      # Claude's latest context
  │   ├── handoff-gemini.json      # Gemini's latest context
  │   └── shared-state.json        # Merged shared state
  └── sessions/
      └── shared-session.json      # Single session both use
```

**Workflow**:
1. Claude exports to `.goodflows/sync/handoff-claude.json`
2. Gemini reads and merges, exports to `.goodflows/sync/handoff-gemini.json`
3. Both can resume the same session

### Option B: Real-Time Sync via MCP Server

```
┌─────────────────────────────────────────────────────────┐
│                   GoodFlows MCP Server                   │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────┐ │
│  │  Session    │  │  Context    │  │  File Watcher   │ │
│  │  Manager    │  │  Store      │  │  (sync changes) │ │
│  └─────────────┘  └─────────────┘  └─────────────────┘ │
├─────────────────────────────────────────────────────────┤
│         ↑                   ↑                   ↑       │
│   Claude Code          Gemini CLI           VS Code     │
│   (backend)            (frontend)           (debug)     │
└─────────────────────────────────────────────────────────┘
```

**New Tools Needed**:
- `goodflows_sync_push` - Push local changes to shared state
- `goodflows_sync_pull` - Pull latest shared state
- `goodflows_sync_status` - Show what's changed since last sync

### Option C: WebSocket Real-Time (Most Advanced)

```
Claude ←──┐
          │
Gemini ←──┼──→ GoodFlows Sync Server (WebSocket)
          │         │
GPT-4 ←───┘         └──→ .goodflows/sync/
```

## Recommended: Option A (File-Based)

**Why**: Simplest to implement, works with any LLM CLI, no server needed.

## Implementation Plan

### Phase 1: Sync Commands (4 hours)

Add CLI commands:

```bash
goodflows sync export          # Export to .goodflows/sync/
goodflows sync import          # Import from .goodflows/sync/
goodflows sync status          # Show sync status
goodflows sync merge           # Merge contexts from multiple LLMs
```

### Phase 2: MCP Tools (3 hours)

Add MCP tools:

```javascript
goodflows_sync_export({ llm: "claude", includeFindings: true })
goodflows_sync_import({ llm: "gemini" })
goodflows_sync_merge({ sources: ["claude", "gemini"] })
goodflows_sync_status()
```

### Phase 3: Conflict Resolution (2 hours)

Handle merge conflicts:
- Same file modified by both LLMs
- Conflicting findings
- Session state conflicts

### Phase 4: Role-Based Context (2 hours)

Filter context by role:

```javascript
goodflows_export_handoff({
  role: "frontend",
  includeFiles: ["src/components/**", "src/pages/**"],
  excludeFiles: ["src/api/**", "src/server/**"]
})
```

## Example Workflow

### Claude (Backend) → Gemini (Frontend)

**Claude Code**:
```javascript
// 1. Claude starts backend work
goodflows_session_start({ trigger: "backend-api" })
goodflows_start_work({ type: "api-implementation" })

// 2. Claude completes API work
goodflows_track_file({ path: "src/api/users.js", action: "created" })
goodflows_complete_work({ success: true })

// 3. Export for Gemini
goodflows_sync_export({
  llm: "claude",
  role: "backend",
  message: "API endpoints ready for frontend integration"
})
```

**Gemini CLI**:
```javascript
// 1. Gemini imports Claude's context
goodflows_sync_import({ llm: "claude" })
goodflows_session_resume({ sessionId: "..." })

// 2. Gemini starts frontend work
goodflows_start_work({ type: "frontend-integration" })

// 3. Gemini builds UI
goodflows_track_file({ path: "src/components/UserList.jsx", action: "created" })

// 4. Export back
goodflows_sync_export({
  llm: "gemini",
  role: "frontend",
  message: "UI components ready, need API types"
})
```

**Claude Code** (continues):
```javascript
// Claude imports Gemini's updates
goodflows_sync_import({ llm: "gemini" })
// Can see Gemini's progress and continue
```

## Files to Create

| File | Purpose |
|------|---------|
| `lib/sync-manager.js` | Core sync logic |
| `bin/cli/sync.js` | CLI commands |
| `bin/mcp/handlers/sync.js` | MCP tool handlers |

## Success Criteria

1. Claude can export context, Gemini can import and resume
2. Both LLMs can see each other's tracked files/findings
3. Session state merges cleanly without data loss
4. Works without any external server (file-based)

## Timeline

| Phase | Effort | Dependencies |
|-------|--------|--------------|
| Phase 1: CLI | 4 hours | None |
| Phase 2: MCP | 3 hours | Phase 1 |
| Phase 3: Conflicts | 2 hours | Phase 2 |
| Phase 4: Roles | 2 hours | Phase 2 |

**Total**: ~11 hours
