# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

# GoodFlows - Claude Agent Suite

## Project Overview

GoodFlows is a multi-agent AI system for automated code review, issue tracking, and fix application. It integrates CodeRabbit reviews with Linear issue management and uses Claude models for intelligent automation.

**Version**: 1.3.0
**Repository**: https://github.com/goodwiins/goodflows
**License**: MIT

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    review-orchestrator                       │
│                    (Sonnet - Coordinator)                    │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐  │
│  │   Phase 1   │→ │   Phase 2   │→ │      Phase 3        │  │
│  │   Review    │  │  Categorize │  │   Create Issues     │  │
│  └─────────────┘  └─────────────┘  └──────────┬──────────┘  │
│                                                │             │
├────────────────────────────────────────────────┼─────────────┤
│                  Agent Registry                │             │
│    (Schemas, Session Context, Invocations)     │             │
├────────────────────────────────────────────────┼─────────────┤
│                    ┌───────────────────────────┼─────────┐  │
│                    ↓                           ↓         │  │
│            ┌──────────────┐           ┌──────────────┐   │  │
│            │ issue-creator│           │  auto-fixer  │   │  │
│            │   (Haiku)    │           │   (Opus)     │   │  │
│            └──────────────┘           └──────────────┘   │  │
└─────────────────────────────────────────────────────────────┘
```

## Agent Files

| Agent                      | Model  | Purpose                                        |
| -------------------------- | ------ | ---------------------------------------------- |
| `review-orchestrator.md`   | Sonnet | Coordinates the complete review lifecycle      |
| `issue-creator.md`         | Haiku  | Creates structured Linear issues from findings |
| `coderabbit-auto-fixer.md` | Opus   | Applies fixes safely with verification         |

## Shared Configuration

### Linear Labels

| Finding Type          | Labels                 | Priority   |
| --------------------- | ---------------------- | ---------- |
| `critical_security`   | `security`, `critical` | 1 (Urgent) |
| `potential_issue`     | `bug`                  | 2 (High)   |
| `refactor_suggestion` | `improvement`          | 3 (Normal) |
| `performance`         | `performance`          | 3 (Normal) |
| `documentation`       | `docs`                 | 4 (Low)    |

### Issue Title Conventions

| Type          | Prefix       | Example                                |
| ------------- | ------------ | -------------------------------------- |
| Security      | `[SECURITY]` | `[SECURITY] Exposed API key in config` |
| Bug           | `fix:`       | `fix: Null pointer in user handler`    |
| Refactor      | `refactor:`  | `refactor: Extract validation logic`   |
| Performance   | `perf:`      | `perf: Optimize database query`        |
| Documentation | `docs:`      | `docs: Update API documentation`       |

### Memory & Context Storage

GoodFlows uses a **hybrid storage strategy** for maximum compatibility:

#### Serena Memory (Legacy - `.serena/memories/`)

| File                     | Purpose                             |
| ------------------------ | ----------------------------------- |
| `coderabbit_findings.md` | History of all review findings      |
| `auto_fix_patterns.md`   | Reusable fix templates and patterns |
| `agent_runs.md`          | Execution history and metrics       |

#### GoodFlows Context Store (Enhanced - `.goodflows/context/`)

| Path                     | Purpose                             | Format |
| ------------------------ | ----------------------------------- | ------ |
| `index.json`             | Fast hash-based lookups             | JSON   |
| `findings/*.jsonl`       | Partitioned findings by month       | JSONL  |
| `patterns/patterns.json` | Fix patterns with confidence scores | JSON   |
| `patterns/history.jsonl` | Pattern usage history               | JSONL  |
| `sessions/*.json`        | Agent run sessions                  | JSON   |

#### Key Features

- **Content-hash deduplication** - SHA-256 based exact duplicate detection
- **Trigram similarity search** - Fuzzy matching for near-duplicates
- **Bloom filter** - Fast probabilistic duplicate check
- **Pattern confidence scoring** - Bayesian-updated success rates
- **Monthly partitioning** - Efficient storage for large histories

#### CLI Commands

```bash
# Initialize context store
goodflows init

# View statistics
goodflows stats

# Migrate from Serena memory
goodflows migrate

# Query findings
goodflows context --query "security"

# Export to markdown
goodflows context --export
```

## Agent Registry (Inter-Agent Communication)

The Agent Registry provides programmatic invocation between agents with validated contracts.

### Key Features

- **Input/Output Schemas** - Validated contracts for each agent
- **Session Context** - Propagate context through multi-agent workflows
- **Priority Sorting** - Process critical findings first
- **Invocation Tracking** - History of all agent calls
- **Checkpoints** - Rollback support for recovery

### Usage

```javascript
import { createAgentRegistry } from "goodflows/lib";

const registry = createAgentRegistry();

// Start session with metadata
const sessionId = registry.startSession({
  trigger: "code-review",
  branch: "feature-x",
});

// Write to shared context
registry.setContext("findings.all", findings);

// Create checkpoint before risky operations
const checkpoint = registry.checkpoint("before_issues");

// Create validated invocation
const invocation = registry.createInvocation("issue-creator", {
  findings: registry.sortByPriority(findings),
  team: "GOO",
  sessionId,
});

// Read from shared context (written by other agents)
const createdIssues = registry.getContext("issues.created", []);

// Rollback if needed
if (error) registry.rollback(checkpoint);

// End session
registry.endSession({ totalIssues: createdIssues.length });
```

## Session Context Manager

The Session Context Manager enables shared state across agent invocations.

### How It Works

```
Without Session Context:
  Orchestrator → issue-creator → auto-fixer
       ↓              ↓              ↓
  (has context)  (no context)   (no context)

With Session Context:
  Orchestrator → issue-creator → auto-fixer
       ↓              ↓              ↓
  (creates)      (reads/writes)  (reads/writes)
       └──────── shared context ────────┘
```

### Key Concepts

| Concept         | Description                                                   |
| --------------- | ------------------------------------------------------------- |
| **Session**     | Workflow execution with unique ID, persists to disk           |
| **Context**     | Shared state organized by namespace (findings, issues, fixes) |
| **Checkpoints** | Snapshots for rollback if operations fail                     |
| **Events**      | Timeline of what happened for debugging                       |

### Context Namespaces

| Path                | Written By    | Read By                   |
| ------------------- | ------------- | ------------------------- |
| `findings.all`      | orchestrator  | issue-creator, auto-fixer |
| `findings.critical` | orchestrator  | issue-creator             |
| `issues.created`    | issue-creator | orchestrator, auto-fixer  |
| `issues.details`    | issue-creator | auto-fixer                |
| `fixes.applied`     | auto-fixer    | orchestrator              |
| `fixes.failed`      | auto-fixer    | orchestrator              |

### Session Lifecycle

```javascript
import { SessionContextManager } from "goodflows/lib";

// 1. Create session (orchestrator)
const session = new SessionContextManager();
const sessionId = session.start({ trigger: "code-review" });

// 2. Resume session (other agents)
const session = SessionContextManager.resume(sessionId);

// 3. Read/Write context
session.set("findings.critical", criticalFindings);
const findings = session.get("findings.all", []);

// 4. Checkpoints & rollback
const chk = session.checkpoint("before_fixes");
// ... if something fails ...
session.rollback(chk);

// 5. Track events
session.addEvent("issues_created", { count: 5 });

// 6. Complete session
session.complete({ totalIssues: 5, fixesApplied: 3 });
```

### Available Schemas

| Agent                   | Input                                  | Output                       |
| ----------------------- | -------------------------------------- | ---------------------------- |
| `review-orchestrator`   | reviewType, autoFix, priorityThreshold | summary, issues, errors      |
| `issue-creator`         | findings[], team, options              | created[], duplicatesSkipped |
| `coderabbit-auto-fixer` | issues[], options                      | fixed[], failed[]            |

### Shared Constants

```javascript
PRIORITY_LEVELS = { critical_security: 1, potential_issue: 2, ... }
LABEL_MAPPING = { critical_security: ['security', 'critical'], ... }
TITLE_PREFIXES = { critical_security: '[SECURITY]', potential_issue: 'fix:', ... }
```

## Priority Queue

Ensures critical security issues are always processed before lower-priority items.

### How It Works

```
Without Priority Queue:
  [doc, bug, SECURITY, perf, bug] → processed in discovery order
                  ↓
  SECURITY issue processed 3rd (too late!)

With Priority Queue:
  [doc, bug, SECURITY, perf, bug]
                  ↓ auto-sorted
  [SECURITY, bug, bug, perf, doc] → critical first!
```

### Usage

```javascript
import { createAgentRegistry, PRIORITY } from "goodflows/lib";

const registry = createAgentRegistry();

// Create queue (auto-sorts by priority)
registry.createQueue(findings, {
  throttleMs: 100, // Rate limiting
  priorityThreshold: PRIORITY.HIGH, // Only P1 and P2
});

// Process in priority order
while (!registry.getQueue().isEmpty()) {
  const finding = registry.nextFinding();
  try {
    await createIssue(finding);
    registry.completeFinding({ issueId: "GOO-31" });
  } catch (error) {
    registry.failFinding(error); // Auto-retry up to 3x
  }
}

// Or process all at once with handler
await registry.processQueue(async (finding) => {
  return await createIssue(finding);
});
```

### Priority Mapping

| Finding Type          | Priority | Level  |
| --------------------- | -------- | ------ |
| `critical_security`   | P1       | Urgent |
| `potential_issue`     | P2       | High   |
| `refactor_suggestion` | P3       | Normal |
| `performance`         | P3       | Normal |
| `documentation`       | P4       | Low    |

### Queue Features

| Feature          | Description                             |
| ---------------- | --------------------------------------- |
| **Auto-sorting** | Items sorted by priority on enqueue     |
| **Throttling**   | Rate limiting between API calls         |
| **Retry**        | Failed items auto-retry up to 3x        |
| **Filtering**    | Skip items below priority threshold     |
| **Stats**        | Track pending, completed, failed counts |

## GSD (Get Shit Done) Integration

GoodFlows includes a complete GSD system for phase-based project execution with atomic commits.

### Overview

```
PROJECT.md (Vision) → ROADMAP.md (Phases) → PLAN.md (Tasks) → SUMMARY.md (Results)
                                  ↓
                    Atomic commits per task
                    Deviation handling
                    Checkpoint support
```

### GSD Agents

| Agent         | Model  | Purpose                              |
| ------------- | ------ | ------------------------------------ |
| `planner.md`  | Sonnet | Creates PLAN.md files with XML tasks |
| `executor.md` | Opus   | Executes plans with per-task commits |

### Context Files

| File         | Purpose                                 | Size Limit  |
| ------------ | --------------------------------------- | ----------- |
| `PROJECT.md` | Vision and architecture (always loaded) | 2K tokens   |
| `ROADMAP.md` | Phases and milestones                   | 3K tokens   |
| `STATE.md`   | Current position and session memory     | 1.5K tokens |
| `PLAN.md`    | Current atomic task in XML format       | 1K tokens   |
| `SUMMARY.md` | Execution history                       | 5K tokens   |
| `ISSUES.md`  | Deferred work queue                     | 2K tokens   |

### GSD MCP Tools

| Tool                               | Description                          |
| ---------------------------------- | ------------------------------------ |
| `goodflows_phase_create`           | Create a new phase in ROADMAP.md     |
| `goodflows_phase_plan`             | Create PLAN.md(s) for a phase        |
| `goodflows_phase_status`           | Get current phase progress           |
| `goodflows_phase_complete`         | Mark phase as complete               |
| `goodflows_phase_list`             | List all phases                      |
| `goodflows_plan_get`               | Get a specific plan                  |
| `goodflows_plan_create_multi_task` | Create multi-task PLAN.md            |
| `goodflows_summary_create`         | Create SUMMARY.md for completed plan |
| `goodflows_gsd_execute_plan`       | Execute PLAN.md with atomic commits  |
| `goodflows_gsd_commit_task`        | Create atomic commit for a task      |
| `goodflows_gsd_resume_checkpoint`  | Resume after checkpoint pause        |

### Execution Strategies

| Strategy     | Description                        | Use When                    |
| ------------ | ---------------------------------- | --------------------------- |
| `autonomous` | Full execution without stopping    | No checkpoints needed       |
| `segmented`  | Pause at checkpoints               | Human verification required |
| `decision`   | Pause at decision checkpoints only | User choices needed         |

### Commit Format

All commits follow conventional format:

```
{type}({phase}-{plan}): {task-name}
```

**Types**: `feat`, `fix`, `test`, `refactor`, `perf`, `chore`, `docs`

**Example commits:**

```
feat(02-01): Create user model
fix(02-01): Add input validation
test(02-01): Add user model tests
docs(02-01): complete plan  # Metadata commit
```

### Deviation Rules

| Rule | Category         | Trigger                   | Action             |
| ---- | ---------------- | ------------------------- | ------------------ |
| 1    | Bug Found        | Discovered existing bug   | Auto-fix, document |
| 2    | Critical Missing | Security/correctness gap  | Auto-add, commit   |
| 3    | Blocker          | Can't proceed without fix | Auto-fix, document |
| 4    | Architectural    | Design change needed      | **STOP**, ask user |
| 5    | Enhancement      | Nice-to-have              | Defer to ISSUES.md |

### GSD Workflow Example

```javascript
// 1. Create phase
goodflows_phase_create({ name: "api-endpoints", goal: "REST API" });

// 2. Create plan
goodflows_phase_plan({
  phase: 2,
  tasks: [
    { name: "Create user model", action: "...", verify: "prisma validate" },
    { name: "Add validation", action: "...", verify: "npm test" },
    {
      type: "checkpoint:human-verify",
      whatBuilt: "User model",
      gate: "blocking",
    },
  ],
});

// 3. Execute plan
goodflows_gsd_execute_plan({ phase: 2, plan: 1, strategy: "segmented" });
// Returns: { tasks, commits, deviations, summaryCreated, nextStep }

// 4. Resume after checkpoint (if needed)
goodflows_gsd_resume_checkpoint({
  planPath: ".goodflows/phases/02-api-endpoints/02-01-PLAN.md",
  checkpointId: "task-3",
  approved: true,
});
```

### Plan XML Structure

```xml
---
phase: 02-api-endpoints
plan: 01
type: execute
---

<objective>
Create REST API with user endpoints
Purpose: Enable user management
Output: User model, validation, tests
</objective>

<tasks>

<task type="auto" id="task-1">
  <name>Create user model</name>
  <files>prisma/schema.prisma, src/models/user.ts</files>
  <action>Add User model with id, email, passwordHash</action>
  <verify>npx prisma validate</verify>
  <done>User model exists with required fields</done>
</task>

<task type="checkpoint:human-verify" id="task-2" gate="blocking">
  <what-built>User model and validation</what-built>
  <how-to-verify>1. Run prisma studio 2. Check model</how-to-verify>
  <resume-signal>approved</resume-signal>
</task>

</tasks>

<verification>
- [ ] npm test passes
- [ ] Build succeeds
</verification>
```

### Directory Structure

```
.goodflows/
├── PROJECT.md          # Project vision (always loaded)
├── ROADMAP.md          # Phase definitions
├── STATE.md            # Current session state
├── PLAN.md             # Active plan (symlink or copy)
├── SUMMARY.md          # Recent execution summaries
├── ISSUES.md           # Deferred work
├── phases/
│   ├── 01-foundation/
│   │   ├── 01-01-PLAN.md
│   │   ├── 01-01-SUMMARY.md
│   │   └── 01-CONTEXT.md
│   └── 02-api-endpoints/
│       ├── 02-01-PLAN.md
│       └── 02-01-SUMMARY.md
└── context/            # GoodFlows context store
```

## Claude Agent SDK Integration

GoodFlows can be used with the [Claude Agent SDK](https://platform.claude.com/docs/en/agent-sdk/overview) for production deployments.

### Quick Start

```javascript
import { query } from "@anthropic-ai/claude-agent-sdk";
import { createGoodFlowsConfig } from "goodflows/lib";

const config = createGoodFlowsConfig();

for await (const message of query({
  prompt: "Run full code review and create Linear issues",
  options: {
    allowedTools: ["Read", "Glob", "Grep", "Bash", "Edit", "Task"],
    agents: config.agents,
    hooks: config.hooks,
    mcpServers: config.mcpServers,
  },
})) {
  console.log(message);
}
```

### Even Simpler

```javascript
import { runGoodFlows } from "goodflows/lib";

const result = await runGoodFlows("Run full code review");
console.log(result.summary);
```

### SDK Integration Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                   Claude Agent SDK                          │
│  ┌────────────────────────────────────────────────────────┐│
│  │                    query()                              ││
│  │  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐   ││
│  │  │  orchestrator │ │ issue-creator│ │  auto-fixer  │   ││
│  │  │   (Sonnet)    │ │   (Haiku)    │ │   (Opus)     │   ││
│  │  └──────────────┘ └──────────────┘ └──────────────┘   ││
│  └────────────────────────────────────────────────────────┘│
│                            ↓                                │
│  ┌────────────────────────────────────────────────────────┐│
│  │                     SDK Hooks                           ││
│  │  PreToolUse → Priority sorting, Deduplication          ││
│  │  PostToolUse → Pattern tracking, Context sync          ││
│  └────────────────────────────────────────────────────────┘│
│                            ↓                                │
│  ┌────────────────────────────────────────────────────────┐│
│  │                   MCP Servers                           ││
│  │  linear-mcp-server    serena-mcp-server                ││
│  └────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│                  GoodFlows Extensions                        │
│  PriorityQueue │ ContextStore │ PatternTracker │ Deduplication │
└─────────────────────────────────────────────────────────────┘
```

### What SDK Provides vs GoodFlows Adds

| Feature           | SDK Built-in         | GoodFlows Adds            |
| ----------------- | -------------------- | ------------------------- |
| Agent execution   | ✓ query(), tool loop | -                         |
| Subagents         | ✓ AgentDefinition    | Model selection per agent |
| Sessions          | ✓ resume, fork       | Checkpoints, rollback     |
| Hooks             | ✓ Pre/Post tool use  | Priority queue, dedup     |
| MCP               | ✓ Native support     | Linear/Serena config      |
| Priority ordering | -                    | ✓ Critical first          |
| Deduplication     | -                    | ✓ Trigram similarity      |
| Pattern tracking  | -                    | ✓ Fix confidence          |

### Available Exports

```javascript
import {
  GOODFLOWS_AGENTS, // Agent definitions for SDK
  createGoodFlowsHooks, // Hooks with GoodFlows features
  createGoodFlowsConfig, // Complete SDK configuration
  runGoodFlows, // One-liner execution
} from "goodflows/lib";
```

## MCP Server Setup

GoodFlows requires MCP servers to be configured in Claude Code settings.

### Quick Setup

Add to your Claude Code settings (`~/.claude/settings.json` or project `.claude/settings.local.json`):

```json
{
  "mcpServers": {
    "goodflows": {
      "command": "npx",
      "args": ["goodflows-mcp-server"]
    },
    "linear": {
      "command": "npx",
      "args": ["@anthropic-ai/linear-mcp-server"],
      "env": {
        "LINEAR_API_KEY": "your-linear-api-key"
      }
    }
  }
}
```

### GoodFlows MCP Tools

| Tool                                | Description                                             |
| ----------------------------------- | ------------------------------------------------------- |
| `goodflows_context_query`           | Query findings by type, file, status                    |
| `goodflows_context_add`             | Add finding with deduplication                          |
| `goodflows_context_check_duplicate` | Check for duplicate/similar findings                    |
| `goodflows_context_update`          | Update finding status, link to issue                    |
| `goodflows_context_export`          | Export to markdown                                      |
| `goodflows_session_start`           | Start workflow session                                  |
| `goodflows_session_resume`          | Resume existing session                                 |
| `goodflows_session_get_context`     | Read from shared context                                |
| `goodflows_session_set_context`     | Write to shared context                                 |
| `goodflows_session_checkpoint`      | Create rollback point                                   |
| `goodflows_session_rollback`        | Rollback to checkpoint                                  |
| `goodflows_pattern_recommend`       | Get fix pattern recommendations                         |
| `goodflows_pattern_record_success`  | Record successful fix                                   |
| `goodflows_pattern_record_failure`  | Record failed fix                                       |
| `goodflows_queue_create`            | Create priority queue                                   |
| `goodflows_queue_next`              | Get next priority item                                  |
| `goodflows_stats`                   | Get store statistics (includes project/GitHub info)     |
| `goodflows_project_info`            | Get project name, version, and GitHub repo info         |
| `goodflows_export_handoff`          | Export state for LLM/IDE handoff                        |
| `goodflows_generate_resume_prompt`  | Generate prompt for another LLM to resume               |
| `goodflows_sync_linear`             | Sync issues from Linear to context store                |
| `goodflows_auto_index`              | Configure automatic indexing of findings                |
| `goodflows_track_file`              | Track a file operation (created/modified/deleted)       |
| `goodflows_track_files`             | Track multiple files at once                            |
| `goodflows_track_issue`             | Track an issue operation (created/fixed/skipped/failed) |
| `goodflows_track_finding`           | Track a finding                                         |
| `goodflows_start_work`              | Start a work unit (groups related tracking)             |
| `goodflows_complete_work`           | Complete work unit and get summary                      |
| `goodflows_get_tracking_summary`    | Get summary of all tracked items                        |

### Easy Tracking

GoodFlows provides easy tracking helpers that automatically update stats and context.

**Basic Tracking:**

```javascript
// Track files
session.trackFile("src/auth.ts", "created");
session.trackFile("src/utils.ts", "modified");
session.trackFiles(["a.ts", "b.ts", "c.ts"], "created");

// Track issues
session.trackIssue("GOO-53", "created", { title: "Fix auth" });
session.trackIssue("GOO-53", "fixed");
session.trackIssue("GOO-54", "skipped", { reason: "duplicate" });

// Track findings
session.trackFinding({ type: "security", file: "auth.ts", description: "..." });
```

**Work Units (recommended for complex tasks):**

```javascript
// Start work unit - groups all subsequent tracking
session.startWork("fix-issue", { issueId: "GOO-53", title: "Thread Export" });

// Track work (automatically linked to work unit)
session.trackFile("src/export/index.ts", "created");
session.trackFile("src/export/formats/md.ts", "created");
session.trackIssue("GOO-53", "fixed");

// Complete work - calculates totals automatically
const summary = session.completeWork({ success: true, endpoints: 5 });
// summary = { filesCreated: 2, issuesFixed: 1, duration: 45, success: true, endpoints: 5 }
```

**Benefits:**

- Auto-updates `stats` (issuesCreated, fixesApplied, etc.)
- Auto-updates `context` for backwards compatibility
- Deduplicates tracked items
- Groups work into logical units
- `_derived` summary is now accurate

### Project & GitHub Awareness

GoodFlows automatically detects project and GitHub information:

**Auto-detected from:**

- `package.json` - project name, version, description
- `.git/config` - GitHub owner, repo, remote URL
- `.git/HEAD` - current branch

**Available via:**

```javascript
// Get project info
goodflows_project_info();
// Returns: { project: { name, version, ... }, github: { owner, repo, url, branch, ... } }

// Stats now include project info
goodflows_stats();
// Returns: { project: { name, version }, github: { owner, repo, branch, url }, context: {...}, ... }
```

**Auto-populated in sessions:**

```javascript
// Sessions automatically include project context
goodflows_session_start({ trigger: "code-review" });
// Session metadata includes: project, projectVersion, github, githubOwner, githubRepo, branch
```

### LLM/IDE Handoff

GoodFlows is **LLM-agnostic** - switch seamlessly between Claude, GPT-4, Gemini, or any model. Switch between Cursor, VS Code, Windsurf, or any IDE with MCP support.

**Export current state for handoff:**

```javascript
goodflows_export_handoff();
// Returns: { project, github, sessions, findings, resumeInstructions }

// Or export specific session
goodflows_export_handoff({ sessionId: "session_xxx" });
```

**Generate a resume prompt for another LLM:**

```javascript
// Concise prompt (default)
goodflows_generate_resume_prompt({ sessionId: "session_xxx" });

// Detailed prompt with full context
goodflows_generate_resume_prompt({
  sessionId: "session_xxx",
  style: "detailed",
});

// Technical/JSON format
goodflows_generate_resume_prompt({
  sessionId: "session_xxx",
  style: "technical",
});
```

**Handoff workflow:**

1. **In current IDE (Claude/Cursor):**

   ```javascript
   // Export state before switching
   goodflows_export_handoff();
   // Or generate a prompt
   goodflows_generate_resume_prompt({ style: "detailed" });
   ```

2. **In new IDE (GPT-4/VS Code):**

   - Configure GoodFlows MCP server
   - Paste the generated prompt, or:

   ```javascript
   // Verify connection
   goodflows_project_info();

   // Resume session
   goodflows_session_resume({ sessionId: "session_xxx" });

   // Check progress
   goodflows_get_tracking_summary();
   ```

**What gets preserved:**

- Project and GitHub context
- Session state and metadata
- Tracking progress (files, issues, findings)
- Work units and summaries
- Open findings and issues

### Auto-Indexing

GoodFlows supports automatic indexing of findings from multiple sources:

#### Linear Sync

Sync issues from Linear to the context store. Two methods:

**Method 1: Using Linear MCP (Recommended)**

```javascript
// Step 1: Fetch issues via Linear MCP
const issues = await linear_list_issues({ team: "GOO" });

// Step 2: Sync to GoodFlows context store
goodflows_sync_linear({ issues: issues });
```

**Method 2: Direct API (requires LINEAR_API_KEY)**

```javascript
// Sync all open issues for a team
goodflows_sync_linear({ team: "GOO", status: "open" });

// Sync issues with specific labels
goodflows_sync_linear({ team: "GOO", labels: ["bug", "security"] });

// Sync issues created after a date
goodflows_sync_linear({ team: "GOO", since: "2024-01-01" });
```

#### Auto-Index Hook

A PostToolUse hook automatically indexes Linear issues when created via the Linear MCP server. Configure in `.claude/settings.local.json`:

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "mcp__linear__linear_create_issue",
        "hooks": [
          {
            "type": "command",
            "command": "node /path/to/goodflows/bin/hooks/index-linear-issue.js"
          }
        ]
      }
    ]
  }
}
```

#### Enable/Disable Auto-Indexing

```javascript
// Enable auto-indexing
goodflows_auto_index({
  enabled: true,
  sources: ["linear", "coderabbit", "fixes"],
});

// Disable auto-indexing
goodflows_auto_index({ enabled: false });
```

### Linear MCP Tools

| Tool                       | Description          |
| -------------------------- | -------------------- |
| `linear_list_teams`        | Get available teams  |
| `linear_create_issue`      | Create a new issue   |
| `linear_update_issue`      | Update issue status  |
| `linear_create_comment`    | Add comment to issue |
| `linear_list_issue_labels` | Get available labels |
| `linear_get_issue`         | Get issue details    |
| `linear_search_issues`     | Search for issues    |

### Serena MCP Tools (Optional)

| Tool                              | Description               |
| --------------------------------- | ------------------------- |
| `serena_find_symbol`              | Find symbol definition    |
| `serena_find_referencing_symbols` | Find symbol references    |
| `serena_get_symbols_overview`     | Get file symbol structure |
| `serena_replace_symbol_body`      | Replace symbol code       |
| `serena_replace_content`          | Regex-based replacement   |
| `serena_read_file`                | Read file content         |
| `serena_read_memory`              | Read from Serena memory   |
| `serena_write_memory`             | Write to Serena memory    |

## Development Guidelines

### Agent Definition Structure

```markdown
---
name: agent-name
description: When to use this agent...
model: opus|sonnet|haiku
color: orange|cyan|blue|green|purple
tools:
  # GoodFlows tools
  - goodflows_context_query
  - goodflows_session_start
  # Linear tools
  - linear_create_issue
  # Serena tools (optional)
  - serena_find_symbol
triggers:
  - "trigger phrase one"
  - "trigger phrase two"
---

[Agent instructions...]
```

### Code Style

- Use consistent Markdown formatting
- Tables for structured data
- Code blocks with language hints
- Mermaid diagrams for workflows

### Error Handling Pattern

All agents should include:

1. **Prerequisites check** - Validate tools/APIs available
2. **Graceful degradation** - Fallback options when primary fails
3. **Failure documentation** - Log failures for debugging
4. **Recovery guidance** - Suggest manual steps if automation fails

### Inter-Agent Communication

Agents communicate via:

1. **Memory files** - Shared state in `.serena/memories/`
2. **Linear issues** - Issue IDs as references
3. **Return values** - Structured output format

Standard output format:

```json
{
  "status": "success|partial|failed",
  "issues_created": ["GOO-XX", ...],
  "issues_fixed": ["GOO-YY", ...],
  "errors": [...],
  "next_steps": [...]
}
```

## Running the Agents

### Full Review Workflow

```
"run full code review and create issues"
"review and track all changes"
```

### Create Issues Only

```
"create Linear issues from these findings: ..."
```

### Fix Specific Issue

```
"/fix-linear GOO-31"
"fix the issue in GOO-31"
```

## Prerequisites

### Required Tools

- CodeRabbit CLI (`coderabbit`)
- Linters: `ruff`, `mypy`, `eslint`, `tsc`
- Git

### Required API Access

- Anthropic API (Claude models)
- Linear API (issue management)
- Serena MCP Server

## Troubleshooting

### Common Issues

**CodeRabbit not found**

```bash
# Install CodeRabbit CLI
pip install coderabbit-cli
# or
npm install -g @coderabbit/cli
```

**Linear API errors**

- Verify API token is set
- Check team permissions
- Ensure labels exist

**Serena memory not found**

- Initialize with `mcp__plugin_serena_serena__write_memory`
- Check `.serena/memories/` directory exists

## Development Commands

### Testing

```bash
npm test                    # Run all tests (Vitest)
npm run test:watch         # Watch mode
npm run test:coverage      # Generate coverage report
npm run test:legacy        # Run legacy test suite
```

**Test Framework**: Vitest with coverage support via @vitest/coverage-v8

**Coverage Thresholds** (vitest.config.js):

- Statements: 60%
- Branches: 50%
- Functions: 60%
- Lines: 60%

**Test Files**:

- `tests/unit/context-store.test.js` - Storage, deduplication, partitioning
- `tests/unit/context-index.test.js` - Trigram similarity, indexing
- `tests/unit/priority-queue.test.js` - Queue ordering, retry logic
- `tests/unit/gsd-executor.test.js` - Plan execution, commits, deviation rules
- `tests/unit/phase-manager.test.js` - Phase/plan directory management
- `tests/unit/errors.test.js` - Error types and handling

**Test Patterns**: `tests/**/*.test.js`
**Coverage Excludes**: `lib/test-workflow.js`, `lib/index.js`

### Linting

```bash
npm run lint               # Run ESLint with auto-fix
npm run lint:check         # Check without fixing
```

**ESLint Config**: Uses @eslint/js with ES module support

### Building & Publishing

```bash
npm run prepublishOnly     # Runs tests before publishing
npm publish                # Publish to NPM (requires auth)
```

**Package Type**: ES Module (`"type": "module"`)
**Node Requirement**: >= 18.0.0
**Binary Entry Points**:

- `goodflows` → `bin/goodflows.js` (CLI)
- `goodflows-mcp-server` → `bin/mcp-server.js` (MCP server)
- `goodflows-install` → `bin/install.sh` (shell installer)

### Local Development

```bash
# Clone and set up
git clone https://github.com/goodwiins/goodflows.git
cd goodflows
npm install

# Link for local testing
npm link

# Test installation
goodflows install

# Unlink when done
npm unlink -g goodflows
```

### NPM Install Scripts

```bash
npm run install:claude      # Install for Claude Code
npm run install:cursor      # Install for Cursor
npm run install:continue    # Install for Continue.dev
npm run install:aider       # Install for Aider
npm run install:windsurf    # Install for Windsurf
```

### Make Commands

## Core Architecture Patterns

### 1. Multi-Agent Coordination Pattern

**Key Insight**: Agents communicate through SessionContextManager, not direct calls. This enables:

- Loose coupling between agents
- Resumable workflows across LLM/IDE switches
- Complete audit trail of all interactions

**Implementation**: `/lib/session-context.js` (1310 LOC)

```javascript
// Orchestrator creates session
const session = new SessionContextManager();
const sessionId = session.start({ trigger: "code-review" });
session.set("findings.all", findings);

// Subagent resumes session by ID (different process, possibly different LLM)
const session = SessionContextManager.resume(sessionId);
const findings = session.get("findings.all"); // Shared state preserved
```

**Why this matters**: Traditional agent systems lose context when agents spawn. GoodFlows maintains context via persistent session files in `.goodflows/context/sessions/`, enabling workflows to survive crashes, IDE switches, or even switching from Claude to GPT-4.

### 2. Hybrid Storage Strategy

**Problem**: Need both fast lookups AND historical queryability at scale.

**Solution**: Dual storage system

- **Context Store** (`.goodflows/context/`) - Fast, partitioned, indexed
- **Serena Memory** (`.serena/memories/`) - Legacy, markdown-based, human-readable

**Implementation**: `/lib/context-store.js` (876 LOC)

**Key Features**:

- **Monthly Partitioning**: Findings split into `2025-01.jsonl`, `2025-02.jsonl`, etc. for efficient querying
- **Content-Hash Deduplication**: SHA-256 based exact duplicate detection
- **Trigram Similarity**: Near-duplicate detection via `/lib/context-index.js` (544 LOC)
- **TTL Management**: Configurable retention (findings: 30d, patterns: forever, sessions: 7d)

### 3. Priority-First Processing

**Problem**: Security issues shouldn't wait behind documentation fixes.

**Solution**: Priority queue with auto-sorting

**Implementation**: `/lib/priority-queue.js` (604 LOC)

```javascript
// Findings auto-sorted on enqueue
registry.createQueue(findings, {
  throttleMs: 100, // Rate limiting
  priorityThreshold: PRIORITY.HIGH, // Only P1 and P2
});

// Always processes highest priority first
const finding = registry.nextFinding(); // Returns P1 before P2 before P3
```

**Priority Mapping**:

- P1 (Urgent): `critical_security`
- P2 (High): `potential_issue`
- P3 (Normal): `refactor_suggestion`, `performance`
- P4 (Low): `documentation`

### 4. GSD (Get Shit Done) Execution Model

**Key Innovation**: Atomic commits per task with deviation handling

**Implementation**: `/lib/gsd-executor.js` (735 LOC), `/lib/phase-manager.js` (1110 LOC)

**Commit Format**:

```
{type}({phase}-{plan}): {task-name}

Examples:
feat(02-01): Create user model
fix(02-01): Add input validation
test(02-01): Add user model tests
docs(02-01): complete plan  # Metadata commit
```

**Deviation Rules** (auto-handle issues found during execution):
| Rule | Category | Trigger | Action |
|------|----------|---------|--------|
| 1 | Bug Found | Discovered existing bug | Auto-fix, document |
| 2 | Critical Missing | Security/correctness gap | Auto-add, commit |
| 3 | Blocker | Can't proceed without fix | Auto-fix, document |
| 4 | Architectural | Design change needed | **STOP**, ask user |
| 5 | Enhancement | Nice-to-have | Defer to ISSUES.md |

**Why this matters**: Most automation systems fail when encountering unexpected issues. GSD's deviation rules enable autonomous recovery from common problems while escalating architectural decisions to humans.

### 5. Pattern Learning System

**Problem**: Same bugs get fixed the same way repeatedly.

**Solution**: Bayesian confidence scoring for fix patterns

**Implementation**: `/lib/pattern-tracker.js` (581 LOC)

```javascript
// Get recommended fix pattern
const patterns = goodflows_pattern_recommend({
  type: "security",
  description: "Hardcoded API key in config",
});
// Returns pattern with confidence score (0.0-1.0)

// Record success/failure to update confidence
goodflows_pattern_record_success({ patternId: "env-var-secret" });
goodflows_pattern_record_failure({
  patternId: "env-var-secret",
  reason: "Tests failed",
});
```

**Storage**: `.goodflows/context/patterns/`

- `patterns.json` - Pattern definitions with confidence scores
- `history.jsonl` - Usage history for learning

### 6. Preflight Duplicate Detection

**Problem**: Creating duplicate Linear issues wastes time and clutters the backlog.

**Solution**: Trigram similarity matching against existing issues

**Implementation**: `/lib/context-index.js` (544 LOC) - uses MCP tool `goodflows_preflight_check`

**Match Types**:
| Type | Condition | Is Conflict |
|------|-----------|-------------|
| `exact_match` | Same file + high similarity (>= 0.85) | Yes |
| `likely_duplicate` | Very high description similarity (>= 0.7) | Yes |
| `same_file` | Same file, moderate similarity | No (informational) |
| `similar` | Moderate description similarity | No (informational) |

**Usage**:

```javascript
const result = goodflows_preflight_check({
  action: 'create_issue',
  findings: [{ file: 'auth.js', description: 'Hardcoded API key', type: 'security' }],
  sessionId: 'session_xxx',
  team: 'YourTeam',
  linearIssues: [...],  // Pre-fetched from linear_list_issues
});

if (result.status === 'conflicts_found') {
  // result.conflicts: matches with existing issues
  // result.clear: findings safe to create
  // Prompt user: skip conflicts, link to existing, force create, or abort
}
```

## Critical Implementation Details

### Session Tracking System

**Location**: `/lib/session-context.js` lines 450-650 (tracking methods)

GoodFlows provides **mandatory tracking** for orchestrator visibility. All agents MUST track their work.

**Two patterns**:

1. **Basic Tracking** (simple tasks):

```javascript
session.trackFile("src/auth.ts", "created");
session.trackIssue("GOO-53", "fixed");
session.trackFinding({ type: "security", file: "auth.ts", description: "..." });
```

2. **Work Units** (complex tasks - RECOMMENDED):

```javascript
// Start work unit - groups all subsequent tracking
session.startWork("fix-issue", { issueId: "GOO-53", title: "Thread Export" });

// Track work (automatically linked to work unit)
session.trackFile("src/export/index.ts", "created");
session.trackFile("src/export/formats/md.ts", "created");
session.trackIssue("GOO-53", "fixed");

// Complete work - calculates totals automatically
const summary = session.completeWork({ success: true, endpoints: 5 });
// Returns: { filesCreated: 2, issuesFixed: 1, duration: 45, success: true, endpoints: 5 }
```

**Why it matters**: The orchestrator uses tracking to build the final summary. Without tracking, the orchestrator cannot report what was accomplished.

### Context File Management

**Location**: `/lib/context-files.js` (1072 LOC)

GoodFlows uses **token-limited context files** for agent prompts:

| File         | Purpose                          | Token Limit | Always Loaded       |
| ------------ | -------------------------------- | ----------- | ------------------- |
| `PROJECT.md` | Project vision and architecture  | 2K          | Yes                 |
| `ROADMAP.md` | Phases and milestones            | 3K          | Planning only       |
| `STATE.md`   | Current session memory           | 1.5K        | Yes                 |
| `PLAN.md`    | Current atomic task (XML format) | 1K          | Task execution only |
| `SUMMARY.md` | Execution history                | 5K          | Orchestrators only  |
| `ISSUES.md`  | Deferred work queue              | 2K          | Planning only       |

**Auto-load budget**: 6K tokens total for agent prompts

**Critical**: These files are **size-limited** and will reject writes that exceed limits. The system auto-archives old SUMMARY.md entries to maintain limits.

### XML Task Parser

**Location**: `/lib/xml-task-parser.js` (829 LOC)

PLAN.md files use a custom XML format (not standard XML):

```xml
---
phase: 02-api-endpoints
plan: 01
type: execute
---

<objective>
Create REST API with user endpoints
Purpose: Enable user management
Output: User model, validation, tests
</objective>

<tasks>

<task type="auto" id="task-1">
  <name>Create user model</name>
  <files>prisma/schema.prisma, src/models/user.ts</files>
  <action>Add User model with id, email, passwordHash</action>
  <verify>npx prisma validate</verify>
  <done>User model exists with required fields</done>
</task>

<task type="checkpoint:human-verify" id="task-2" gate="blocking">
  <what-built>User model and validation</what-built>
  <how-to-verify>1. Run prisma studio 2. Check model</how-to-verify>
  <resume-signal>approved</resume-signal>
</task>

</tasks>

<verification>
- [ ] npm test passes
- [ ] Build succeeds
</verification>
```

**Parser output**: Structured JavaScript object with metadata, tasks, and execution strategy.

**Why custom XML**: Standard XML parsers don't support the frontmatter YAML + XML hybrid format needed for phase/plan metadata.

### LLM/IDE Handoff System

**Location**: `/lib/session-context.js` (handoff methods), `/bin/hooks/` (pre/post hooks)

GoodFlows is **LLM-agnostic** and **IDE-agnostic**. You can switch from:

- Claude → GPT-4 → Gemini → any LLM
- Claude Code → Cursor → VS Code → Windsurf → any IDE with MCP

**How it works**:

1. **Export** (before switching):

```javascript
goodflows_export_handoff();
// Returns: { project, github, sessions, findings, resumeInstructions }
// Runs: bin/hooks/pre-handoff.js (checks uncommitted changes, etc.)
```

2. **Generate Resume Prompt** (for next LLM):

```javascript
goodflows_generate_resume_prompt({
  sessionId: "session_xxx",
  style: "detailed",
});
// Returns: Copy-paste prompt with full context for next LLM
```

3. **Import** (after switching):

```javascript
goodflows_import_handoff({ content: <PASTE_JSON_HERE> })
// Restores: Sessions, findings, tracking state
// Runs: bin/hooks/post-handoff.js (npm install, verifies deps, etc.)
```

**What gets preserved**:

- Project/GitHub context
- Session state and metadata
- Tracking progress (files, issues, findings)
- Work units and summaries
- Open findings and issues

**Hooks**:

- `bin/hooks/pre-handoff.js` - Validates before export (e.g., checks for uncommitted changes)
- `bin/hooks/post-handoff.js` - Sets up after import (e.g., runs `npm install`)

## Library Module Reference

| Module               | LOC  | Purpose                                       |
| -------------------- | ---- | --------------------------------------------- |
| `session-context.js` | 1310 | Multi-agent state & tracking                  |
| `phase-manager.js`   | 1110 | GSD phase/plan directory management           |
| `context-files.js`   | 1072 | Context file (PROJECT, ROADMAP, etc.) I/O     |
| `sdk-adapter.js`     | 903  | Claude Agent SDK integration                  |
| `context-store.js`   | 876  | Partitioned JSONL storage system              |
| `xml-task-parser.js` | 829  | PLAN.md XML parsing                           |
| `test-workflow.js`   | 770  | Legacy test workflow (excluded from coverage) |
| `plan-executor.js`   | 770  | Subagent orchestration engine                 |
| `agent-registry.js`  | 742  | Agent invocation & validation                 |
| `gsd-executor.js`    | 735  | GSD plan execution with commits               |
| `priority-queue.js`  | 604  | Priority-based processing queue               |
| `pattern-tracker.js` | 581  | Fix pattern learning system                   |
| `context-index.js`   | 544  | Trigram similarity & indexing                 |
| `subagent-runner.js` | 538  | Subagent execution wrapper                    |
| `task-splitter.js`   | 455  | Complex task decomposition                    |
| `index.js`           | 347  | Main library exports                          |
| `errors.js`          | 204  | Error types & handling                        |
| `debug.js`           | 125  | Debug logging utilities                       |

**Total Library Code**: ~17,410 LOC

## Package Information

- **Name**: goodflows
- **Version**: 1.3.0
- **Author**: [@goodwiins](https://github.com/goodwiins)
- **License**: MIT
- **Repository**: https://github.com/goodwiins/goodflows
