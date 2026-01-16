# CLAUDE.md

This file provides guidance to Claude Code when working with this repository.

# GoodFlows - Claude Agent Suite

## Project Overview

GoodFlows is a multi-agent AI system for automated code review, issue tracking, and fix application. Integrates CodeRabbit, Linear, and Claude models.

**Version**: 1.3.0 | **Repository**: https://github.com/goodwiins/goodflows | **License**: MIT

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    review-orchestrator (Sonnet)              │
│     Phase 1: Review → Phase 2: Categorize → Phase 3: Issues │
├─────────────────────────────────────────────────────────────┤
│              Agent Registry (Schemas, Sessions)              │
├─────────────────────────────────────────────────────────────┤
│       issue-creator (Haiku)  │  auto-fixer (Opus)           │
└─────────────────────────────────────────────────────────────┘
```

## Agent Files

| Agent                      | Model  | Purpose                         |
| -------------------------- | ------ | ------------------------------- |
| `plan-orchestrator.md`     | Sonnet | Main agent orchestration pattern |
| `task-executor.md`         | Sonnet | Lightweight subtask execution   |
| `review-orchestrator.md`   | Sonnet | Coordinates review lifecycle    |
| `issue-creator.md`         | Haiku  | Creates Linear issues           |
| `coderabbit-auto-fixer.md` | Opus   | Applies fixes with verification |

## CRITICAL: MCP Tool Access in Subagents

**MCP tools are NOT available in background subagents.** This is a Claude Code limitation.

### Correct Architecture

```
Main Agent (has MCP access)
  ├── goodflows_session_start()     ← MCP call in MAIN
  ├── goodflows_start_work()        ← MCP call in MAIN
  │
  ├── Task(task-executor)           ← Subagent (NO MCP)
  │     └── Returns: { files, status }
  ├── goodflows_track_file()        ← MCP call in MAIN
  │
  └── goodflows_complete_work()     ← MCP call in MAIN
```

### Rules

1. **Main agent handles all MCP calls** - session, tracking, Linear
2. **Subagents do execution only** - Read, Write, Edit, Bash
3. **Pass context via prompt** - not via MCP session
4. **Track results after subagent returns** - in main agent

## Shared Configuration

### Priority & Labels

| Type                  | Labels                 | Priority    | Prefix       |
| --------------------- | ---------------------- | ----------- | ------------ |
| `critical_security`   | `security`, `critical` | P1 (Urgent) | `[SECURITY]` |
| `potential_issue`     | `bug`                  | P2 (High)   | `fix:`       |
| `refactor_suggestion` | `improvement`          | P3 (Normal) | `refactor:`  |
| `performance`         | `performance`          | P3 (Normal) | `perf:`      |
| `documentation`       | `docs`                 | P4 (Low)    | `docs:`      |

### Storage

**GoodFlows Context Store** (`.goodflows/context/`):

- `index.json` - Fast hash-based lookups
- `findings/*.jsonl` - Monthly partitioned findings
- `patterns/` - Fix patterns with Bayesian confidence
- `sessions/` - Agent run sessions

**Features**: Content-hash deduplication, trigram similarity search, Bloom filter, pattern confidence scoring

## Key Components

### Agent Registry

Programmatic agent invocation with validated contracts, session context, priority sorting, and checkpoint rollback.

### Session Context Manager

Shared state across agents. Enables workflow persistence across LLM/IDE switches.

**Namespaces**: `findings.all`, `findings.critical`, `issues.created`, `issues.details`, `fixes.applied`, `fixes.failed`

### Priority Queue

Auto-sorts by priority. P1 (security) always processed first. Includes throttling, retry (3x), and filtering.

## GSD (Get Shit Done) Integration

Phase-based project execution with atomic commits per task.

**Flow**: `PROJECT.md` → `ROADMAP.md` → `PLAN.md` → `SUMMARY.md`

### Context Files

| File         | Purpose                | Limit |
| ------------ | ---------------------- | ----- |
| `PROJECT.md` | Vision (always loaded) | 2K    |
| `ROADMAP.md` | Phases                 | 3K    |
| `STATE.md`   | Session memory         | 1.5K  |
| `PLAN.md`    | Current task (XML)     | 1K    |
| `SUMMARY.md` | History                | 5K    |
| `ISSUES.md`  | Deferred work          | 2K    |

### GSD MCP Tools

| Tool                              | Description                 |
| --------------------------------- | --------------------------- |
| `goodflows_phase_create`          | Create phase                |
| `goodflows_phase_plan`            | Create PLAN.md(s)           |
| `goodflows_phase_status`          | Get progress                |
| `goodflows_gsd_execute_plan`      | Execute with atomic commits |
| `goodflows_gsd_commit_task`       | Create atomic commit        |
| `goodflows_gsd_resume_checkpoint` | Resume after checkpoint     |

### Execution Strategies

- `autonomous` - Full execution without stopping
- `segmented` - Pause at checkpoints
- `decision` - Pause at decision points only

### Commit Format

```
{type}({phase}-{plan}): {task-name}
Example: feat(02-01): Create user model
```

### Deviation Rules

| Category         | Trigger       | Action             |
| ---------------- | ------------- | ------------------ |
| Bug Found        | Existing bug  | Auto-fix           |
| Critical Missing | Security gap  | Auto-add           |
| Blocker          | Can't proceed | Auto-fix           |
| Architectural    | Design change | **STOP**, ask user |
| Enhancement      | Nice-to-have  | Defer to ISSUES.md |

## MCP Server Setup

Add to Claude Code settings:

```json
{
  "mcpServers": {
    "goodflows": { "command": "npx", "args": ["goodflows-mcp-server"] },
    "linear": {
      "command": "npx",
      "args": ["@anthropic-ai/linear-mcp-server"],
      "env": { "LINEAR_API_KEY": "your-key" }
    }
  }
}
```

### Core MCP Tools

**Context**: `goodflows_context_query`, `goodflows_context_add`, `goodflows_context_check_duplicate`, `goodflows_context_update`, `goodflows_context_export`

**Sessions**: `goodflows_session_start`, `goodflows_session_resume`, `goodflows_session_get_context`, `goodflows_session_set_context`, `goodflows_session_checkpoint`, `goodflows_session_rollback`

**Patterns**: `goodflows_pattern_recommend`, `goodflows_pattern_record_success`, `goodflows_pattern_record_failure`

**Queue**: `goodflows_queue_create`, `goodflows_queue_next`

**Tracking**: `goodflows_track_file`, `goodflows_track_files`, `goodflows_track_issue`, `goodflows_track_finding`, `goodflows_start_work`, `goodflows_complete_work`, `goodflows_get_tracking_summary`

**Utility**: `goodflows_stats`, `goodflows_project_info`, `goodflows_export_handoff`, `goodflows_generate_resume_prompt`, `goodflows_sync_linear`, `goodflows_auto_index`, `goodflows_preflight_check`

### Tracking (Required)

All agents MUST track their work for orchestrator visibility:

```javascript
session.trackFile("src/auth.ts", "created");
session.trackIssue("GOO-53", "fixed");

// Work units (recommended)
session.startWork("fix-issue", { issueId: "GOO-53" });
session.trackFile("src/export/index.ts", "created");
session.completeWork({ success: true });
```

### LLM/IDE Handoff

GoodFlows is LLM-agnostic. Switch between Claude, GPT-4, Gemini, Cursor, VS Code, Windsurf.

```javascript
// Export before switching
goodflows_export_handoff();
goodflows_generate_resume_prompt({ sessionId: "xxx", style: "detailed" });

// Resume in new IDE
goodflows_session_resume({ sessionId: "xxx" });
```

### Preflight Duplicate Detection

Before creating issues, check for duplicates:

```javascript
goodflows_preflight_check({
  action: 'create_issue',
  findings: [...],
  linearIssues: [...]  // Pre-fetched from linear_list_issues
});
```

## Development Commands

```bash
# Testing (Vitest)
npm test                    # Run all tests
npm run test:coverage       # Coverage report

# Linting
npm run lint               # ESLint with auto-fix
npm run lint:check         # Check only

# Local development
npm link                   # Link for testing
goodflows install          # Test installation
```

**Coverage Thresholds**: Statements 40%, Branches 50%, Functions 50%, Lines 40%

**Test Files**: `tests/unit/*.test.js` (context-store, context-index, priority-queue, gsd-executor, phase-manager, errors)

## Claude Agent SDK

```javascript
import { runGoodFlows } from "goodflows/lib";
const result = await runGoodFlows("Run full code review");
```

**Exports**: `GOODFLOWS_AGENTS`, `createGoodFlowsHooks`, `createGoodFlowsConfig`, `runGoodFlows`

## Library Modules

| Module               | LOC  | Purpose                         |
| -------------------- | ---- | ------------------------------- |
| `session-context.js` | 1310 | Multi-agent state & tracking    |
| `phase-manager.js`   | 1110 | Phase/plan directory management |
| `context-files.js`   | 1072 | Context file I/O                |
| `context-store.js`   | 876  | Partitioned JSONL storage       |
| `xml-task-parser.js` | 829  | PLAN.md XML parsing             |
| `gsd-executor.js`    | 735  | GSD execution with commits      |
| `priority-queue.js`  | 604  | Priority-based queue            |
| `pattern-tracker.js` | 581  | Fix pattern learning            |
| `context-index.js`   | 544  | Trigram similarity              |

**Total**: ~17,410 LOC

## Troubleshooting

- **CodeRabbit not found**: `pip install coderabbit-cli` or `npm install -g @coderabbit/cli`
- **Linear API errors**: Verify token, check team permissions, ensure labels exist
- **Serena memory not found**: Check `.serena/memories/` directory exists
