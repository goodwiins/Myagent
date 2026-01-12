# Context Engineering Implementation Plan

## Executive Summary

Implement a structured context engineering system for GoodFlows that ensures Claude agents always have the context they need through well-organized files with XML-formatted task definitions, size limits, and verification steps.

---

## Problem Statement

Claude Code's quality degrades when:
1. Context is scattered or missing
2. Tasks are ambiguous or poorly defined
3. Session memory is lost between invocations
4. Decisions and blockers aren't tracked
5. There's no verification of completion

GoodFlows already has session management and tracking, but lacks **structured context files** that provide persistent, always-available project intelligence.

---

## Architecture Overview

```
.goodflows/
├── context/                    # Existing context store
│   ├── findings/
│   ├── patterns/
│   └── sessions/
├── PROJECT.md                  # NEW: Project vision (always loaded)
├── ROADMAP.md                  # NEW: Goals, milestones, progress
├── STATE.md                    # NEW: Current state, decisions, blockers
├── PLAN.md                     # NEW: Current atomic task (XML)
├── SUMMARY.md                  # NEW: Execution history
├── ISSUES.md                   # NEW: Deferred work queue
└── todos/                      # NEW: Idea capture
    └── *.md
```

---

## Context File Specifications

### 1. PROJECT.md - Project Vision (Always Loaded)

**Purpose**: Defines what the project IS. Loaded into every agent's context.

**Size Limit**: 2,000 tokens (~1,500 words)

**Structure**:
```markdown
# Project: [Name]

## Vision
[1-2 sentences: What problem does this solve?]

## Core Principles
- [Principle 1]
- [Principle 2]
- [Principle 3]

## Architecture
[High-level architecture description]

## Key Technologies
- [Tech 1]: [Why]
- [Tech 2]: [Why]

## Boundaries
- DO: [What the project does]
- DON'T: [What it explicitly doesn't do]
```

**Auto-loading**: YES - Injected into every agent prompt

---

### 2. ROADMAP.md - Where We're Going

**Purpose**: Tracks goals, milestones, and what's been accomplished.

**Size Limit**: 3,000 tokens (~2,000 words)

**Structure**:
```markdown
# Roadmap

## Current Milestone
**[Milestone Name]** - [Target Date]

### Goals
- [ ] Goal 1
- [x] Goal 2 (completed)
- [ ] Goal 3

### Blockers
- [Blocker description] → [Resolution path]

## Completed Milestones
### [Previous Milestone] - [Date Completed]
- [Summary of what was achieved]

## Future Milestones
### [Next Milestone]
- [Brief description]
```

**Auto-loading**: On session start, for orchestrators

---

### 3. STATE.md - Session Memory

**Purpose**: Preserves decisions, blockers, and position across sessions. This is the "memory" that survives context resets.

**Size Limit**: 1,500 tokens (~1,000 words)

**Structure**:
```markdown
# Current State

## Last Updated
[ISO timestamp]

## Active Session
- ID: [session_id]
- Started: [timestamp]
- Trigger: [what started this]

## Current Position
[What we're working on right now]

## Recent Decisions
| Decision | Rationale | Date |
|----------|-----------|------|
| [Decision 1] | [Why] | [Date] |

## Active Blockers
- [ ] [Blocker 1]: [Status]

## Context for Next Session
[What the next agent/session needs to know]
```

**Auto-loading**: YES - Critical for continuity

---

### 4. PLAN.md - Atomic Task Definition (XML)

**Purpose**: Defines the CURRENT atomic task with verification steps.

**Size Limit**: 1,000 tokens (~700 words)

**Structure**:
```xml
<task type="implementation|fix|refactor|review">
  <name>Human-readable task name</name>

  <context>
    <why>Why this task matters</why>
    <depends-on>Prerequisites or dependent tasks</depends-on>
    <session>session_id if part of workflow</session>
  </context>

  <scope>
    <files>
      <file action="create|modify|delete">path/to/file.ts</file>
      <file action="modify">path/to/other.ts</file>
    </files>
    <boundaries>What NOT to touch</boundaries>
  </scope>

  <action>
    Precise instructions for what to do.
    - Step 1
    - Step 2
    - Step 3
  </action>

  <verify>
    <check type="command">npm run test</check>
    <check type="command">npm run lint</check>
    <check type="manual">Endpoint returns expected response</check>
  </verify>

  <done>
    Definition of done - when is this task complete?
  </done>

  <tracking>
    <goodflows>true</goodflows>
    <track-files>true</track-files>
    <track-issues>true</track-issues>
  </tracking>
</task>
```

**Auto-loading**: When starting task execution

---

### 5. SUMMARY.md - Execution History

**Purpose**: Records what happened, changes made, committed to history.

**Size Limit**: 5,000 tokens (~3,500 words) - rolling window, oldest entries archived

**Structure**:
```markdown
# Execution Summary

## Latest Execution
**Date**: [ISO timestamp]
**Task**: [Task name from PLAN.md]
**Status**: success|partial|failed

### Changes Made
- [file1.ts]: [what changed]
- [file2.ts]: [what changed]

### Verification Results
- [x] Tests passed
- [x] Lint passed
- [ ] Manual verification: [status]

### Issues Created
- GOO-XX: [title]

### Notes
[Any important observations]

---

## Previous Executions
[Older entries in reverse chronological order]
```

**Auto-loading**: On orchestrator start (for context)

---

### 6. ISSUES.md - Deferred Work Queue

**Purpose**: Captures work that should be done later, not now.

**Size Limit**: 2,000 tokens

**Structure**:
```markdown
# Deferred Issues

## High Priority
- [ ] **[Issue Title]** - [Brief description]
  - Discovered: [date]
  - Context: [why it was deferred]

## Normal Priority
- [ ] **[Issue Title]** - [Brief description]

## Low Priority / Ideas
- [ ] **[Idea]** - [Brief description]

## Resolved
- [x] **[Issue Title]** - Resolved in [session/commit]
```

**Auto-loading**: On planning phases

---

### 7. todos/ Directory - Idea Capture

**Purpose**: Quick capture of ideas, tasks, and notes that don't fit elsewhere.

**Structure**: Individual markdown files, one per topic

```markdown
# [Topic Name]

## Captured
[timestamp]

## Idea
[Description]

## Related
- [Links to related files/issues]
```

**Auto-loading**: Never auto-loaded, queried on demand

---

## Implementation Tasks

<task type="implementation">
  <name>Create Context File Manager</name>

  <files>
    <file action="create">lib/context-files.js</file>
  </files>

  <action>
    Create a ContextFileManager class that:
    1. Initializes context file structure in .goodflows/
    2. Provides read/write methods for each file type
    3. Enforces size limits with warnings
    4. Handles auto-loading logic
    5. Integrates with existing SessionContextManager
  </action>

  <verify>
    <check type="command">node -e "import('./lib/context-files.js')"</check>
  </verify>

  <done>
    ContextFileManager exports working read/write methods for all context file types
  </done>
</task>

---

<task type="implementation">
  <name>Create XML Task Parser</name>

  <files>
    <file action="create">lib/xml-task-parser.js</file>
  </files>

  <action>
    Create parser that:
    1. Parses PLAN.md XML task definitions
    2. Validates required fields (name, action, verify, done)
    3. Extracts file scope for tracking
    4. Generates verification commands
    5. Integrates with GoodFlows tracking
  </action>

  <verify>
    <check type="command">node -e "import('./lib/xml-task-parser.js')"</check>
  </verify>

  <done>
    Parser correctly extracts all task fields and returns structured object
  </done>
</task>

---

<task type="implementation">
  <name>Add MCP Tools for Context Files</name>

  <files>
    <file action="modify">bin/mcp-server.js</file>
  </files>

  <action>
    Add MCP tools:
    - goodflows_context_file_read(file: "PROJECT"|"ROADMAP"|"STATE"|"PLAN"|"SUMMARY"|"ISSUES")
    - goodflows_context_file_write(file, content)
    - goodflows_context_file_append(file, section, content)
    - goodflows_plan_parse() - Parse current PLAN.md XML
    - goodflows_plan_verify() - Run verification checks
    - goodflows_summary_add(execution) - Add to SUMMARY.md
    - goodflows_state_update(updates) - Update STATE.md
  </action>

  <verify>
    <check type="manual">MCP tools appear in tool list</check>
  </verify>

  <done>
    All context file MCP tools are registered and functional
  </done>
</task>

---

<task type="implementation">
  <name>Integrate Context Files with Agent Prompts</name>

  <files>
    <file action="modify">lib/subagent-runner.js</file>
  </files>

  <action>
    Modify buildSubagentPrompt to:
    1. Always inject PROJECT.md content
    2. Inject STATE.md for continuity
    3. Inject PLAN.md when task is defined
    4. Include relevant ROADMAP.md section for orchestrators
    5. Respect size limits (truncate with warning if exceeded)
  </action>

  <verify>
    <check type="manual">Generated prompts include context file content</check>
  </verify>

  <done>
    Subagent prompts automatically include relevant context files
  </done>
</task>

---

<task type="implementation">
  <name>Create Context Engineering CLI Commands</name>

  <files>
    <file action="modify">bin/cli.js</file>
  </files>

  <action>
    Add CLI commands:
    - goodflows context init - Initialize all context files with templates
    - goodflows context status - Show context file sizes and health
    - goodflows context plan <task> - Create PLAN.md from description
    - goodflows context verify - Run PLAN.md verification checks
    - goodflows context summarize - Generate SUMMARY.md from session
  </action>

  <verify>
    <check type="command">goodflows context --help</check>
  </verify>

  <done>
    All CLI commands work and produce expected output
  </done>
</task>

---

<task type="implementation">
  <name>Update Agent Files with Context Loading</name>

  <files>
    <file action="modify">agents/review-orchestrator.md</file>
    <file action="modify">agents/plan-orchestrator.md</file>
    <file action="modify">agents/issue-creator.md</file>
    <file action="modify">agents/coderabbit-auto-fixer.md</file>
  </files>

  <action>
    Update each agent to:
    1. Add context file MCP tools to tools list
    2. Add instructions to read PROJECT.md at start
    3. Add instructions to read/update STATE.md
    4. Add instructions to append to SUMMARY.md on completion
    5. Add instructions to check PLAN.md for current task
  </action>

  <verify>
    <check type="manual">Agents reference context files in their workflows</check>
  </verify>

  <done>
    All agents have context file awareness built into their instructions
  </done>
</task>

---

## Size Limit Rationale

| File | Limit | Reasoning |
|------|-------|-----------|
| PROJECT.md | 2K tokens | Always loaded; must be concise |
| ROADMAP.md | 3K tokens | Loaded for planning; moderate detail |
| STATE.md | 1.5K tokens | Always loaded; must be current snapshot |
| PLAN.md | 1K tokens | Task-specific; must be precise |
| SUMMARY.md | 5K tokens | History; rolling window with archival |
| ISSUES.md | 2K tokens | Deferred work; prioritized list |

**Total auto-loaded context**: ~4.5K tokens (PROJECT + STATE + PLAN)

This leaves ~195K tokens for actual task execution in a 200K context window.

---

## Integration Points

### With Existing GoodFlows

```
┌─────────────────────────────────────────────────────────────┐
│                     Context Engineering                      │
│  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐          │
│  │PROJECT  │ │ROADMAP  │ │ STATE   │ │  PLAN   │          │
│  │  .md    │ │  .md    │ │  .md    │ │  .md    │          │
│  └────┬────┘ └────┬────┘ └────┬────┘ └────┬────┘          │
│       │           │           │           │                │
│       └───────────┴───────────┴───────────┘                │
│                       │                                     │
│              ┌────────▼────────┐                           │
│              │ ContextFileManager │                        │
│              └────────┬────────┘                           │
│                       │                                     │
├───────────────────────┼─────────────────────────────────────┤
│                       │                                     │
│              ┌────────▼────────┐                           │
│              │ SessionContextManager │ (existing)          │
│              └────────┬────────┘                           │
│                       │                                     │
│  ┌────────────────────┼────────────────────┐               │
│  │                    │                    │               │
│  ▼                    ▼                    ▼               │
│ Tracking           Sessions            Context Store       │
│ (files,issues)     (state)            (findings,patterns) │
└─────────────────────────────────────────────────────────────┘
```

### With Claude Code

1. **CLAUDE.md** references PROJECT.md for vision
2. **Agents** read context files via MCP tools
3. **Subagent prompts** auto-inject relevant context
4. **Sessions** update STATE.md on changes
5. **Completions** append to SUMMARY.md

---

## Execution Order

1. **Phase 1**: Create ContextFileManager (`lib/context-files.js`)
2. **Phase 2**: Create XML Task Parser (`lib/xml-task-parser.js`)
3. **Phase 3**: Add MCP tools (`bin/mcp-server.js`)
4. **Phase 4**: Integrate with subagent prompts (`lib/subagent-runner.js`)
5. **Phase 5**: Add CLI commands (`bin/cli.js`)
6. **Phase 6**: Update agent files (all `agents/*.md`)

---

## Success Criteria

- [ ] All context files have templates and are auto-created on `goodflows init`
- [ ] PROJECT.md and STATE.md are auto-loaded into every agent prompt
- [ ] PLAN.md XML is parsed and verification steps are executable
- [ ] SUMMARY.md is auto-updated after task completion
- [ ] Size limits are enforced with warnings
- [ ] Agents can read/write context files via MCP tools
- [ ] CLI provides context management commands

---

## Risk Mitigation

| Risk | Mitigation |
|------|------------|
| Context files become stale | Auto-timestamp, validation on read |
| Size limits exceeded | Warning + truncation + archival |
| XML parsing errors | Graceful fallback to raw text |
| Conflict with existing session data | ContextFileManager wraps SessionContextManager |
| Agent doesn't read context | Make it MANDATORY in agent instructions |

---

## Next Steps

1. Review this plan
2. Create `lib/context-files.js` implementation
3. Iterate through remaining tasks
4. Test full workflow with sample project
