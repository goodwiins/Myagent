# GoodFlows - Claude Agent Suite

## Project Overview

GoodFlows is a multi-agent AI system for automated code review, issue tracking, and fix application. It integrates CodeRabbit reviews with Linear issue management and uses Claude models for intelligent automation.

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

| Agent | Model | Purpose |
|-------|-------|---------|
| `review-orchestrator.md` | Sonnet | Coordinates the complete review lifecycle |
| `issue-creator.md` | Haiku | Creates structured Linear issues from findings |
| `coderabbit-auto-fixer.md` | Opus | Applies fixes safely with verification |

## Shared Configuration

### Linear Labels

| Finding Type | Labels | Priority |
|--------------|--------|----------|
| `critical_security` | `security`, `critical` | 1 (Urgent) |
| `potential_issue` | `bug` | 2 (High) |
| `refactor_suggestion` | `improvement` | 3 (Normal) |
| `performance` | `performance` | 3 (Normal) |
| `documentation` | `docs` | 4 (Low) |

### Issue Title Conventions

| Type | Prefix | Example |
|------|--------|---------|
| Security | `[SECURITY]` | `[SECURITY] Exposed API key in config` |
| Bug | `fix:` | `fix: Null pointer in user handler` |
| Refactor | `refactor:` | `refactor: Extract validation logic` |
| Performance | `perf:` | `perf: Optimize database query` |
| Documentation | `docs:` | `docs: Update API documentation` |

### Memory & Context Storage

GoodFlows uses a **hybrid storage strategy** for maximum compatibility:

#### Serena Memory (Legacy - `.serena/memories/`)

| File | Purpose |
|------|---------|
| `coderabbit_findings.md` | History of all review findings |
| `auto_fix_patterns.md` | Reusable fix templates and patterns |
| `agent_runs.md` | Execution history and metrics |

#### GoodFlows Context Store (Enhanced - `.goodflows/context/`)

| Path | Purpose | Format |
|------|---------|--------|
| `index.json` | Fast hash-based lookups | JSON |
| `findings/*.jsonl` | Partitioned findings by month | JSONL |
| `patterns/patterns.json` | Fix patterns with confidence scores | JSON |
| `patterns/history.jsonl` | Pattern usage history | JSONL |
| `sessions/*.json` | Agent run sessions | JSON |

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
import { createAgentRegistry } from 'goodflows/lib';

const registry = createAgentRegistry();

// Start session with metadata
const sessionId = registry.startSession({ trigger: 'code-review', branch: 'feature-x' });

// Write to shared context
registry.setContext('findings.all', findings);

// Create checkpoint before risky operations
const checkpoint = registry.checkpoint('before_issues');

// Create validated invocation
const invocation = registry.createInvocation('issue-creator', {
  findings: registry.sortByPriority(findings),
  team: 'GOO',
  sessionId,
});

// Read from shared context (written by other agents)
const createdIssues = registry.getContext('issues.created', []);

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

| Concept | Description |
|---------|-------------|
| **Session** | Workflow execution with unique ID, persists to disk |
| **Context** | Shared state organized by namespace (findings, issues, fixes) |
| **Checkpoints** | Snapshots for rollback if operations fail |
| **Events** | Timeline of what happened for debugging |

### Context Namespaces

| Path | Written By | Read By |
|------|------------|---------|
| `findings.all` | orchestrator | issue-creator, auto-fixer |
| `findings.critical` | orchestrator | issue-creator |
| `issues.created` | issue-creator | orchestrator, auto-fixer |
| `issues.details` | issue-creator | auto-fixer |
| `fixes.applied` | auto-fixer | orchestrator |
| `fixes.failed` | auto-fixer | orchestrator |

### Session Lifecycle

```javascript
import { SessionContextManager } from 'goodflows/lib';

// 1. Create session (orchestrator)
const session = new SessionContextManager();
const sessionId = session.start({ trigger: 'code-review' });

// 2. Resume session (other agents)
const session = SessionContextManager.resume(sessionId);

// 3. Read/Write context
session.set('findings.critical', criticalFindings);
const findings = session.get('findings.all', []);

// 4. Checkpoints & rollback
const chk = session.checkpoint('before_fixes');
// ... if something fails ...
session.rollback(chk);

// 5. Track events
session.addEvent('issues_created', { count: 5 });

// 6. Complete session
session.complete({ totalIssues: 5, fixesApplied: 3 });
```

### Available Schemas

| Agent | Input | Output |
|-------|-------|--------|
| `review-orchestrator` | reviewType, autoFix, priorityThreshold | summary, issues, errors |
| `issue-creator` | findings[], team, options | created[], duplicatesSkipped |
| `coderabbit-auto-fixer` | issues[], options | fixed[], failed[] |

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
import { createAgentRegistry, PRIORITY } from 'goodflows/lib';

const registry = createAgentRegistry();

// Create queue (auto-sorts by priority)
registry.createQueue(findings, {
  throttleMs: 100,                    // Rate limiting
  priorityThreshold: PRIORITY.HIGH,  // Only P1 and P2
});

// Process in priority order
while (!registry.getQueue().isEmpty()) {
  const finding = registry.nextFinding();
  try {
    await createIssue(finding);
    registry.completeFinding({ issueId: 'GOO-31' });
  } catch (error) {
    registry.failFinding(error);  // Auto-retry up to 3x
  }
}

// Or process all at once with handler
await registry.processQueue(async (finding) => {
  return await createIssue(finding);
});
```

### Priority Mapping

| Finding Type | Priority | Level |
|--------------|----------|-------|
| `critical_security` | P1 | Urgent |
| `potential_issue` | P2 | High |
| `refactor_suggestion` | P3 | Normal |
| `performance` | P3 | Normal |
| `documentation` | P4 | Low |

### Queue Features

| Feature | Description |
|---------|-------------|
| **Auto-sorting** | Items sorted by priority on enqueue |
| **Throttling** | Rate limiting between API calls |
| **Retry** | Failed items auto-retry up to 3x |
| **Filtering** | Skip items below priority threshold |
| **Stats** | Track pending, completed, failed counts |

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
  }
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

| Feature | SDK Built-in | GoodFlows Adds |
|---------|-------------|----------------|
| Agent execution | ✓ query(), tool loop | - |
| Subagents | ✓ AgentDefinition | Model selection per agent |
| Sessions | ✓ resume, fork | Checkpoints, rollback |
| Hooks | ✓ Pre/Post tool use | Priority queue, dedup |
| MCP | ✓ Native support | Linear/Serena config |
| Priority ordering | - | ✓ Critical first |
| Deduplication | - | ✓ Trigram similarity |
| Pattern tracking | - | ✓ Fix confidence |

### Available Exports

```javascript
import {
  GOODFLOWS_AGENTS,       // Agent definitions for SDK
  createGoodFlowsHooks,   // Hooks with GoodFlows features
  createGoodFlowsConfig,  // Complete SDK configuration
  runGoodFlows,           // One-liner execution
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

| Tool | Description |
|------|-------------|
| `goodflows_context_query` | Query findings by type, file, status |
| `goodflows_context_add` | Add finding with deduplication |
| `goodflows_context_check_duplicate` | Check for duplicate/similar findings |
| `goodflows_context_update` | Update finding status, link to issue |
| `goodflows_context_export` | Export to markdown |
| `goodflows_session_start` | Start workflow session |
| `goodflows_session_resume` | Resume existing session |
| `goodflows_session_get_context` | Read from shared context |
| `goodflows_session_set_context` | Write to shared context |
| `goodflows_session_checkpoint` | Create rollback point |
| `goodflows_session_rollback` | Rollback to checkpoint |
| `goodflows_pattern_recommend` | Get fix pattern recommendations |
| `goodflows_pattern_record_success` | Record successful fix |
| `goodflows_pattern_record_failure` | Record failed fix |
| `goodflows_queue_create` | Create priority queue |
| `goodflows_queue_next` | Get next priority item |
| `goodflows_stats` | Get store statistics |

### Linear MCP Tools

| Tool | Description |
|------|-------------|
| `linear_list_teams` | Get available teams |
| `linear_create_issue` | Create a new issue |
| `linear_update_issue` | Update issue status |
| `linear_create_comment` | Add comment to issue |
| `linear_list_issue_labels` | Get available labels |
| `linear_get_issue` | Get issue details |
| `linear_search_issues` | Search for issues |

### Serena MCP Tools (Optional)

| Tool | Description |
|------|-------------|
| `serena_find_symbol` | Find symbol definition |
| `serena_find_referencing_symbols` | Find symbol references |
| `serena_get_symbols_overview` | Get file symbol structure |
| `serena_replace_symbol_body` | Replace symbol code |
| `serena_replace_content` | Regex-based replacement |
| `serena_read_file` | Read file content |
| `serena_read_memory` | Read from Serena memory |
| `serena_write_memory` | Write to Serena memory |

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

## Package Information

- **Name**: goodflows
- **Version**: 1.2.0
- **Author**: [@goodwiins](https://github.com/goodwiins)
- **License**: MIT
- **Repository**: https://github.com/goodwiins/goodflows