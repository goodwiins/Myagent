# GoodFlows GSD Integration - Technical Specification

**Created**: 2026-01-12
**Status**: Approved for implementation
**Reference**: https://github.com/glittercowboy/get-shit-done

---

## 1. Architecture Overview

### 1.1 Component Diagram

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          GoodFlows + GSD Integration                         │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌───────────────────┐  ┌───────────────────┐  ┌───────────────────┐       │
│  │    Context Files  │  │   Phase Manager   │  │  Plan Executor    │       │
│  │  ─────────────────│  │  ─────────────────│  │  ─────────────────│       │
│  │  PROJECT.md       │  │  create_phase()   │  │  execute_plan()   │       │
│  │  ROADMAP.md       │  │  plan_phase()     │  │  commit_task()    │       │
│  │  STATE.md         │  │  complete_phase() │  │  verify_task()    │       │
│  │  PLAN.md          │  │  status()         │  │  handle_deviation│       │
│  │  SUMMARY.md       │  │                   │  │  create_summary() │       │
│  │  ISSUES.md        │  │                   │  │                   │       │
│  └─────────┬─────────┘  └─────────┬─────────┘  └─────────┬─────────┘       │
│            │                      │                      │                  │
│            └──────────────────────┼──────────────────────┘                  │
│                                   │                                         │
│                     ┌─────────────┴─────────────┐                           │
│                     │      MCP Server           │                           │
│                     │   (bin/mcp-server.js)     │                           │
│                     └─────────────┬─────────────┘                           │
│                                   │                                         │
│       ┌───────────────────────────┼───────────────────────────┐            │
│       │                           │                           │            │
│  ┌────┴────┐              ┌───────┴───────┐           ┌───────┴───────┐    │
│  │ Planner │              │   Executor    │           │  Orchestrator │    │
│  │  Agent  │              │    Agent      │           │     Agent     │    │
│  │(Sonnet) │              │   (Opus)      │           │   (Sonnet)    │    │
│  └─────────┘              └───────────────┘           └───────────────┘    │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 1.2 Data Flow

```
User Request
     │
     ▼
┌─────────────┐    ┌─────────────┐    ┌─────────────┐    ┌─────────────┐
│  PROJECT.md │───▶│ plan_phase  │───▶│  PLAN.md    │───▶│execute_plan │
│  ROADMAP.md │    │  (Planner)  │    │ (XML tasks) │    │ (Executor)  │
│  STATE.md   │    └─────────────┘    └─────────────┘    └──────┬──────┘
└─────────────┘                                                  │
     ▲                                                           │
     │                                                           ▼
     │                                                  ┌─────────────────┐
     │    ┌─────────────┐    ┌─────────────┐           │ For each task:  │
     └────│ STATE.md    │◀───│ SUMMARY.md  │◀──────────│ • Execute       │
          │ (updated)   │    │ (created)   │           │ • Verify        │
          └─────────────┘    └─────────────┘           │ • Commit        │
                                                       │ • Record hash   │
                                                       └─────────────────┘
```

---

## 2. Context File Specifications

### 2.1 PROJECT.md (2000 tokens max)

**Purpose**: Project vision, always loaded first

**Structure**:
```markdown
# Project: [Name]

## Vision
[1-2 sentences: What problem does this solve?]

## Core Value
[The ONE thing this project must do well]

## Architecture
[High-level architecture]

## Tech Stack
| Technology | Purpose | Notes |
|------------|---------|-------|
| [Tech]     | [Why]   | [Any constraints] |

## Key Decisions
| Decision | Rationale | Date | Phase |
|----------|-----------|------|-------|
| [Decision] | [Why] | [Date] | [Phase #] |

## Boundaries
### DO
- [What project does]

### DON'T
- [What it explicitly doesn't do]

## External Dependencies
- [Dependency]: [Version] - [Purpose]
```

### 2.2 ROADMAP.md (3000 tokens max)

**Purpose**: Phases and milestones tracking

**Structure**:
```markdown
# Roadmap

## Current Milestone: [Name]
**Target**: [Date]
**Progress**: [░░░░░░░░░░] X%

## Phases

### Phase 1: [Name] ✓ COMPLETE
- **Status**: complete
- **Plans**: 2/2 executed
- **Summary**: [One-liner of what shipped]

### Phase 2: [Name] ► IN PROGRESS
- **Status**: in_progress
- **Plans**: 1/3 executed
- **Current**: Plan 2 - [Name]

### Phase 3: [Name]
- **Status**: pending
- **Plans**: 0/0 (not planned)
- **Goal**: [What this phase achieves]

### Phase 4: [Name]
- **Status**: pending
- **Plans**: 0/0 (not planned)
- **Goal**: [What this phase achieves]

---

## Completed Milestones

### v1.0 - [Name]
- Completed: [Date]
- Phases: 4
- Key outcomes: [List]

---

## Phase Dependencies

```
Phase 1 ──► Phase 2
              │
              ▼
         Phase 3 ──► Phase 4
```
```

### 2.3 STATE.md (1500 tokens max)

**Purpose**: Living memory across sessions

**Structure**:
```markdown
# Project State

## Project Reference
See: .goodflows/PROJECT.md (updated [date])
**Core value**: [One-liner from PROJECT.md]
**Current focus**: Phase [X] - [Name]

## Current Position
- **Phase**: [X] of [Y] ([Phase name])
- **Plan**: [A] of [B] in current phase
- **Status**: [Ready to plan | Planning | Ready to execute | In progress | Phase complete]
- **Last activity**: [YYYY-MM-DD] — [What happened]

Progress: [░░░░░░░░░░] X%

## Performance Metrics
**Velocity:**
- Total plans completed: [N]
- Average duration: [X] min
- Total execution time: [X.X] hours

**By Phase:**
| Phase | Plans | Total Time | Avg/Plan |
|-------|-------|------------|----------|
| 1     | 2     | 45min      | 22min    |

## Accumulated Context

### Recent Decisions
- [Phase X]: [Decision summary]
- [Phase Y]: [Decision summary]

### Deferred Issues
[From ISSUES.md — count and brief list]
- ISS-001: [Brief] (Phase 1)

### Active Blockers
[Issues affecting future work]
- None currently

## Session Continuity
- **Last session**: [YYYY-MM-DD HH:MM]
- **Stopped at**: [Description]
- **Resume file**: [Path or "None"]
```

### 2.4 PLAN.md (1000 tokens max)

**Purpose**: Current atomic task in XML format

**Structure**:
```xml
---
phase: XX-name
plan: NN
type: execute
depends_on: []
files_modified: []
---

<objective>
[What this plan accomplishes]

Purpose: [Why this matters]
Output: [What artifacts will be created]
</objective>

<execution_context>
@.goodflows/workflows/execute-plan.md
@.goodflows/templates/summary.md
</execution_context>

<context>
@.goodflows/PROJECT.md
@.goodflows/ROADMAP.md
@.goodflows/STATE.md
[Relevant source files]
</context>

<tasks>

<task type="auto" id="task-1">
  <name>Task 1: [Action-oriented name]</name>
  <files>path/to/file.ext</files>
  <action>
    [Specific implementation instructions]
    - What to do
    - How to do it
    - What to avoid and WHY
  </action>
  <verify>[Command or check to prove it worked]</verify>
  <done>[Measurable acceptance criteria]</done>
</task>

<task type="auto" id="task-2">
  <name>Task 2: [Action-oriented name]</name>
  <files>path/to/file.ext</files>
  <action>[Instructions]</action>
  <verify>[Verification]</verify>
  <done>[Criteria]</done>
</task>

<task type="checkpoint:human-verify" id="task-3" gate="blocking">
  <what-built>[What was just built]</what-built>
  <how-to-verify>
    1. Run: [command]
    2. Visit: [URL]
    3. Test: [Interaction]
  </how-to-verify>
  <resume-signal>Type "approved" to continue</resume-signal>
</task>

</tasks>

<verification>
Before declaring complete:
- [ ] [Test command passes]
- [ ] [Build succeeds]
- [ ] [Behavior verified]
</verification>

<success_criteria>
- All tasks completed
- All verification checks pass
- [Plan-specific criteria]
</success_criteria>
```

**Task Types**:
| Type | Description | Execution |
|------|-------------|-----------|
| `auto` | Execute without stopping | Subagent |
| `checkpoint:human-verify` | User must verify output | Pause, ask user |
| `checkpoint:human-action` | User must do something | Pause, instruct user |
| `checkpoint:decision` | User must choose | Present options, wait |

**Gate Values**:
| Gate | Meaning |
|------|---------|
| `blocking` | Must resolve before continuing |
| `optional` | Can skip or defer |

### 2.5 SUMMARY.md (5000 tokens max)

**Purpose**: Execution history and commit tracking

**Structure**:
```markdown
---
phase: XX-name
plan: YY
subsystem: [auth, payments, ui, api, database, infra, testing]
tags: [jwt, stripe, react, postgres]

requires:
  - phase: [prior phase]
    provides: [what it built]
provides:
  - [what this plan delivers]
affects: [phases/keywords that need this context]

tech-stack:
  added: [libraries added]
  patterns: [patterns established]

key-files:
  created: [files created]
  modified: [files modified]

key-decisions:
  - "Decision 1"
  - "Decision 2"

patterns-established:
  - "Pattern 1: description"

issues-created: [ISS-XXX, ISS-YYY]

duration: Xmin
completed: YYYY-MM-DD
---

# Phase [X] Plan [Y]: [Name] Summary

**[Substantive one-liner - what shipped, not "phase complete"]**

## Performance
- **Duration**: [time]
- **Started**: [ISO timestamp]
- **Completed**: [ISO timestamp]
- **Tasks**: [count]
- **Files modified**: [count]

## Accomplishments
- [Key outcome 1]
- [Key outcome 2]

## Task Commits
Each task committed atomically:

1. **Task 1: [name]** - `abc123f` (feat)
2. **Task 2: [name]** - `def456g` (fix)
3. **Task 3: [name]** - `hij789k` (test)

**Plan metadata**: `lmn012o` (docs: complete plan)

## Files Created/Modified
- `path/to/file.ts` - What it does

## Decisions Made
[Key decisions with rationale, or "None"]

## Deviations from Plan

### Auto-fixed Issues
**1. [Rule X - Category] Brief description**
- **Found during**: Task [N]
- **Issue**: [What was wrong]
- **Fix**: [What was done]
- **Files modified**: [paths]
- **Verification**: [How verified]
- **Committed in**: [hash]

### Deferred Enhancements
- ISS-XXX: [Brief] (Task [N])

## Issues Encountered
[Problems and resolutions, or "None"]

## Next Phase Readiness
[What's ready, blockers, concerns]

---
*Completed: [date]*
```

### 2.6 ISSUES.md (2000 tokens max)

**Purpose**: Deferred work queue

**Structure**:
```markdown
# Deferred Issues

## Open Issues

### ISS-001: [Title]
- **Phase**: 1 (Task 2)
- **Type**: enhancement | bug | tech-debt
- **Effort**: S | M | L
- **Priority**: low | medium | high
- **Description**: [Details]
- **Proposed fix**: [If known]

### ISS-002: [Title]
- **Phase**: 2 (Task 1)
...

## Resolved Issues

### ISS-000: [Title] ✓
- **Resolved in**: Phase 3
- **Resolution**: [What was done]

---

## Issue Statistics
- Open: [N]
- Resolved: [N]
- By Type: enhancement ([N]), bug ([N]), tech-debt ([N])
```

---

## 3. MCP Tool Specifications

### 3.1 Phase Management Tools

#### `goodflows_phase_create`

**Purpose**: Create a new phase in ROADMAP.md

**Input Schema**:
```json
{
  "name": "string (required) - Phase name",
  "goal": "string (required) - What this phase achieves",
  "position": "number (optional) - Where to insert (default: end)",
  "dependsOn": "string[] (optional) - Phase names this depends on"
}
```

**Output**:
```json
{
  "success": true,
  "phaseNumber": 3,
  "phaseName": "03-authentication",
  "roadmapUpdated": true,
  "message": "Phase 3 'authentication' created"
}
```

**Implementation**:
1. Read ROADMAP.md
2. Parse existing phases
3. Generate phase number (zero-padded)
4. Insert phase at position
5. Update phase dependency graph
6. Write ROADMAP.md
7. Update STATE.md current position if first phase

---

#### `goodflows_phase_plan`

**Purpose**: Create atomic PLAN.md(s) for a phase (equivalent to /gsd:plan-phase)

**Input Schema**:
```json
{
  "phase": "number|string (optional) - Phase to plan (default: next unplanned)",
  "sessionId": "string (required) - Session for context",
  "maxTasksPerPlan": "number (optional) - Max tasks per plan (default: 3)",
  "includeCodebaseAnalysis": "boolean (optional) - Analyze codebase for context (default: true)"
}
```

**Output**:
```json
{
  "success": true,
  "phase": 2,
  "phaseName": "02-api-endpoints",
  "plansCreated": [
    {
      "planNumber": 1,
      "path": ".goodflows/phases/02-api-endpoints/02-01-PLAN.md",
      "taskCount": 3,
      "tasks": ["Create user model", "Add validation", "Write tests"]
    },
    {
      "planNumber": 2,
      "path": ".goodflows/phases/02-api-endpoints/02-02-PLAN.md",
      "taskCount": 2,
      "tasks": ["Create auth endpoints", "Add middleware"]
    }
  ],
  "totalTasks": 5,
  "stateUpdated": true,
  "message": "Created 2 plans for Phase 2 with 5 total tasks"
}
```

**Implementation**:
1. Read PROJECT.md, ROADMAP.md, STATE.md
2. Identify target phase (or detect next unplanned)
3. Load phase context if exists (from prior discussion)
4. If includeCodebaseAnalysis:
   - Analyze directory structure
   - Identify relevant files
   - Extract patterns/conventions
5. Break phase goal into tasks
6. Group tasks into plans (max 3 tasks each)
7. Identify dependencies between tasks
8. Generate XML PLAN.md for each plan
9. Create .goodflows/phases/{phase-name}/ directory
10. Write PLAN.md files
11. Update ROADMAP.md plan count
12. Update STATE.md position

---

#### `goodflows_phase_status`

**Purpose**: Get current phase progress

**Input Schema**:
```json
{
  "phase": "number (optional) - Phase to check (default: current)"
}
```

**Output**:
```json
{
  "phase": 2,
  "name": "02-api-endpoints",
  "status": "in_progress",
  "plans": {
    "total": 3,
    "completed": 1,
    "current": 2,
    "pending": 1
  },
  "currentPlan": {
    "number": 2,
    "path": ".goodflows/phases/02-api-endpoints/02-02-PLAN.md",
    "status": "ready_to_execute"
  },
  "tasksCompleted": 3,
  "tasksRemaining": 4,
  "progress": 43,
  "velocity": {
    "avgPlanDuration": "18min",
    "estimatedRemaining": "36min"
  },
  "blockers": [],
  "nextStep": "Execute plan 02-02 with goodflows_execute_plan"
}
```

---

#### `goodflows_phase_complete`

**Purpose**: Mark phase as complete, archive summaries

**Input Schema**:
```json
{
  "phase": "number (required) - Phase to complete",
  "summary": "string (optional) - One-liner summary of what shipped"
}
```

**Output**:
```json
{
  "success": true,
  "phase": 2,
  "summary": "REST API with JWT auth and CRUD endpoints",
  "plansExecuted": 3,
  "totalDuration": "54min",
  "filesModified": 12,
  "commits": 9,
  "roadmapUpdated": true,
  "stateUpdated": true,
  "nextPhase": {
    "number": 3,
    "name": "03-frontend",
    "status": "ready_to_plan"
  }
}
```

---

### 3.2 Plan Execution Tools

#### `goodflows_execute_plan` (Enhanced)

**Purpose**: Execute PLAN.md with per-task atomic commits

**Input Schema**:
```json
{
  "planPath": "string (optional) - Path to PLAN.md (default: .goodflows/PLAN.md)",
  "sessionId": "string (required) - Session for tracking",
  "strategy": "string (optional) - 'auto' | 'segmented' | 'decision' (default: auto-detect)",
  "dryRun": "boolean (optional) - Parse and validate only (default: false)"
}
```

**Output**:
```json
{
  "success": true,
  "planPath": ".goodflows/phases/02-api-endpoints/02-01-PLAN.md",
  "strategy": "autonomous",
  "tasks": [
    {
      "id": "task-1",
      "name": "Create user model",
      "status": "completed",
      "commitHash": "abc123f",
      "commitType": "feat",
      "duration": "8min",
      "filesModified": ["src/models/user.ts", "prisma/schema.prisma"],
      "verificationPassed": true
    },
    {
      "id": "task-2",
      "name": "Add validation",
      "status": "completed",
      "commitHash": "def456g",
      "commitType": "feat",
      "duration": "5min",
      "filesModified": ["src/lib/validation.ts"],
      "verificationPassed": true
    }
  ],
  "deviations": [
    {
      "rule": 2,
      "category": "missing_critical",
      "description": "Added input sanitization",
      "task": "task-2",
      "autoFixed": true
    }
  ],
  "summaryCreated": ".goodflows/phases/02-api-endpoints/02-01-SUMMARY.md",
  "metadataCommit": "lmn012o",
  "totalDuration": "15min",
  "stateUpdated": true,
  "roadmapUpdated": true,
  "nextStep": "Execute plan 02-02 or review summary"
}
```

**Execution Strategies**:

| Strategy | Checkpoints | Execution |
|----------|-------------|-----------|
| `autonomous` | None | Full subagent execution |
| `segmented` | verify-only | Pause at checkpoints, subagent between |
| `decision` | decision checkpoints | Main context, user chooses |

**Deviation Rules** (auto-applied during execution):

| Rule | Category | Action |
|------|----------|--------|
| 1 | Bug found | Auto-fix, document |
| 2 | Critical missing | Auto-add (security, correctness) |
| 3 | Blocker | Auto-fix (can't proceed otherwise) |
| 4 | Architectural | STOP, ask user |
| 5 | Enhancement | Log to ISSUES.md, continue |

**Commit Format**:
- Task commits: `{type}({phase}-{plan}): {task-name}`
- Metadata commit: `docs({phase}-{plan}): complete [plan-name] plan`

**Types**: feat, fix, test, refactor, perf, chore, docs

---

#### `goodflows_task_commit`

**Purpose**: Create atomic commit for a single task

**Input Schema**:
```json
{
  "taskId": "string (required) - Task ID from plan",
  "taskName": "string (required) - Task name for commit message",
  "type": "string (required) - feat|fix|test|refactor|perf|chore",
  "phase": "string (required) - Phase identifier (e.g., '02')",
  "plan": "string (required) - Plan number (e.g., '01')",
  "files": "string[] (required) - Files to stage (individual paths)",
  "sessionId": "string (required) - Session for tracking"
}
```

**Output**:
```json
{
  "success": true,
  "commitHash": "abc123f",
  "commitMessage": "feat(02-01): Create user model",
  "filesStaged": ["src/models/user.ts", "prisma/schema.prisma"],
  "tracked": true
}
```

**Implementation**:
1. Validate files exist
2. Stage files individually (NEVER `git add .`)
3. Create commit with formatted message
4. Record hash
5. Track in session

---

### 3.3 Enhanced XML Task Parser

#### `goodflows_plan_parse` (Enhanced)

**Purpose**: Parse multi-task XML from PLAN.md

**Output Structure**:
```json
{
  "valid": true,
  "metadata": {
    "phase": "02-api-endpoints",
    "plan": "01",
    "type": "execute",
    "dependsOn": [],
    "filesModified": ["src/models/user.ts"]
  },
  "objective": {
    "description": "Create user model and validation",
    "purpose": "Foundation for auth system",
    "output": "User model with validation helpers"
  },
  "context": {
    "projectFile": ".goodflows/PROJECT.md",
    "stateFile": ".goodflows/STATE.md",
    "sourceFiles": ["src/lib/db.ts"]
  },
  "tasks": [
    {
      "id": "task-1",
      "type": "auto",
      "name": "Create user model",
      "files": ["src/models/user.ts", "prisma/schema.prisma"],
      "action": "Add User model with...",
      "verify": "npx prisma validate",
      "done": "Schema valid, types generated"
    },
    {
      "id": "task-2",
      "type": "checkpoint:human-verify",
      "gate": "blocking",
      "whatBuilt": "User registration flow",
      "howToVerify": ["Run dev server", "Visit /register"],
      "resumeSignal": "Type 'approved' to continue"
    }
  ],
  "verification": [
    "npm run build succeeds",
    "npm test passes"
  ],
  "successCriteria": [
    "All tasks completed",
    "All verification passes"
  ],
  "executionStrategy": "segmented",
  "hasCheckpoints": true,
  "checkpointTypes": ["human-verify"]
}
```

---

## 4. Agent Specifications

### 4.1 Planner Agent

**File**: `agents/planner.md`

```yaml
---
name: planner
description: Use this agent to break down phases into atomic task plans. Creates well-structured PLAN.md files with XML tasks, verification steps, and clear success criteria. Call before execution to ensure quality planning.
model: sonnet
color: blue
tools:
  # Standard tools
  - Read
  - Grep
  - Glob
  - WebFetch
  # GoodFlows context
  - goodflows_context_file_read
  - goodflows_context_file_write
  - goodflows_autoload_context
  # GoodFlows phase management
  - goodflows_phase_plan
  - goodflows_phase_status
  - goodflows_roadmap_update
  # GoodFlows planning
  - goodflows_plan_create_xml
  - goodflows_plan_parse
  # Session
  - goodflows_session_start
  - goodflows_session_set_context
  - goodflows_session_get_context
  # Tracking
  - goodflows_start_work
  - goodflows_complete_work
  - goodflows_track_file
triggers:
  - "plan phase"
  - "create plan"
  - "break down this task"
  - "plan next phase"
---
```

**Workflow**:
1. Load context (PROJECT, ROADMAP, STATE)
2. Identify target phase
3. Analyze codebase if needed
4. Generate task breakdown
5. Create XML PLAN.md(s)
6. Update STATE position

### 4.2 Executor Agent

**File**: `agents/executor.md`

```yaml
---
name: executor
description: Use this agent to execute PLAN.md files with atomic per-task commits. Handles verification, deviation rules, and creates SUMMARY.md. Each task gets fresh context preventing degradation.
model: opus
color: green
tools:
  # Standard tools
  - Bash
  - Read
  - Edit
  - Write
  - Glob
  - Grep
  - Task
  # GoodFlows execution
  - goodflows_execute_plan
  - goodflows_task_commit
  - goodflows_plan_parse
  # GoodFlows context
  - goodflows_context_file_read
  - goodflows_context_file_write
  - goodflows_state_update
  - goodflows_summary_add
  # GoodFlows issues
  - goodflows_context_add
  # Session
  - goodflows_session_resume
  - goodflows_session_checkpoint
  - goodflows_session_rollback
  # Tracking
  - goodflows_start_work
  - goodflows_complete_work
  - goodflows_track_file
  - goodflows_track_issue
triggers:
  - "execute plan"
  - "run plan"
  - "execute current plan"
  - "start execution"
---
```

**Workflow**:
1. Parse PLAN.md
2. Determine execution strategy
3. For each task:
   - Execute (subagent if autonomous)
   - Verify completion
   - Handle deviations
   - Atomic commit
4. Create SUMMARY.md
5. Update STATE.md, ROADMAP.md
6. Metadata commit

---

## 5. File Structure

### 5.1 Project Directory Structure

```
project/
├── .goodflows/
│   ├── PROJECT.md           # Project vision (always loaded)
│   ├── ROADMAP.md           # Phases and milestones
│   ├── STATE.md             # Current state and position
│   ├── ISSUES.md            # Deferred work queue
│   ├── config.json          # GoodFlows configuration
│   │
│   ├── phases/
│   │   ├── 01-foundation/
│   │   │   ├── 01-01-PLAN.md
│   │   │   ├── 01-01-SUMMARY.md
│   │   │   ├── 01-02-PLAN.md
│   │   │   └── 01-02-SUMMARY.md
│   │   │
│   │   ├── 02-api-endpoints/
│   │   │   ├── 02-01-PLAN.md
│   │   │   ├── 02-01-SUMMARY.md
│   │   │   └── 02-CONTEXT.md    # Phase discussion context
│   │   │
│   │   └── 03-frontend/
│   │       └── (not yet planned)
│   │
│   ├── context/              # Existing GoodFlows context store
│   │   ├── sessions/
│   │   ├── findings/
│   │   └── patterns/
│   │
│   └── templates/            # File templates
│       ├── plan.xml
│       ├── summary.md
│       └── issue.md
│
└── src/                      # Project source code
```

### 5.2 Naming Conventions

| Item | Format | Example |
|------|--------|---------|
| Phase directory | `{NN}-{kebab-name}` | `02-api-endpoints` |
| Plan file | `{phase}-{plan}-PLAN.md` | `02-01-PLAN.md` |
| Summary file | `{phase}-{plan}-SUMMARY.md` | `02-01-SUMMARY.md` |
| Context file | `{phase}-CONTEXT.md` | `02-CONTEXT.md` |
| Task commit | `{type}({phase}-{plan}): {name}` | `feat(02-01): Create user model` |
| Metadata commit | `docs({phase}-{plan}): complete {name}` | `docs(02-01): complete user-model plan` |
| Issue ID | `ISS-{NNN}` | `ISS-001` |

---

## 6. Implementation Order

### Phase 1: Foundation (Week 1)
1. Update `lib/context-files.js` templates
2. Add phase directory management
3. Enhance `goodflows_plan_create_xml` for multi-task
4. Update `goodflows_plan_parse` for new structure

### Phase 2: Phase Management (Week 1-2)
1. Add `goodflows_phase_create`
2. Add `goodflows_phase_plan`
3. Add `goodflows_phase_status`
4. Add `goodflows_phase_complete`
5. Add `goodflows_roadmap_update`

### Phase 3: Execution Engine (Week 2)
1. Enhance `goodflows_execute_plan`
2. Add `goodflows_task_commit`
3. Implement deviation rules
4. Implement execution strategies
5. Auto-generate SUMMARY.md

### Phase 4: Agents (Week 3)
1. Create `agents/planner.md`
2. Create `agents/executor.md`
3. Update `agents/review-orchestrator.md` integration
4. Update `agents/plan-orchestrator.md` integration

### Phase 5: Testing & Docs (Week 3)
1. Unit tests for new functions
2. Integration tests for workflows
3. Update README.md
4. Update CLAUDE.md

---

## 7. Design Decisions

### 7.1 Storage Location
- Use `.goodflows/phases/` (integrated with existing GoodFlows structure)
- Keep backward compatibility with existing context store

### 7.2 Linear Integration
- Deferred issues (ISS-XXX) stored locally in ISSUES.md
- Option to sync to Linear via `goodflows_sync_linear` when ready to process

### 7.3 Git Workflow
- Atomic commits enforced by default
- Configurable via `config.json` if needed

### 7.4 Checkpoint Handling
- Use `mcp_question` tool for decision checkpoints
- Consistent with existing GoodFlows patterns

### 7.5 Velocity Tracking
- Persist metrics in STATE.md
- Reset on milestone completion, archive in SUMMARY.md

---

## 8. Success Criteria

The integration is complete when:

1. **Context Files**: All 6 context files work with size limits enforced
2. **Phase Management**: Users can create, plan, execute, and complete phases
3. **Plan Execution**: Atomic commits per task with verification
4. **Agents**: Planner and Executor agents function correctly
5. **Tests**: 80%+ coverage on new functionality
6. **Documentation**: README and CLAUDE.md updated

---

*Specification Version: 1.0*
*Last Updated: 2026-01-12*
