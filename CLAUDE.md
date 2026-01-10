# Myagent - Claude Agent Suite

## Project Overview

This is a multi-agent AI system for automated code review, issue tracking, and fix application. It integrates CodeRabbit reviews with Linear issue management and uses Claude models for intelligent automation.

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

### Memory File Paths

All memory files are stored under `.serena/memories/`:

| File | Purpose |
|------|---------|
| `coderabbit_findings.md` | History of all review findings |
| `auto_fix_patterns.md` | Reusable fix templates and patterns |
| `agent_runs.md` | Execution history and metrics |

## MCP Tool Reference

### Serena Tools (Primary)

```
mcp__plugin_serena_serena__find_symbol
mcp__plugin_serena_serena__find_referencing_symbols
mcp__plugin_serena_serena__get_symbols_overview
mcp__plugin_serena_serena__replace_symbol_body
mcp__plugin_serena_serena__replace_content
mcp__plugin_serena_serena__read_file
mcp__plugin_serena_serena__read_memory
mcp__plugin_serena_serena__write_memory
mcp__plugin_serena_serena__search_for_pattern
mcp__plugin_serena_serena__list_dir
```

### Linear Tools

```
mcp__plugin_linear_linear__list_teams
mcp__plugin_linear_linear__create_issue
mcp__plugin_linear_linear__update_issue
mcp__plugin_linear_linear__create_comment
mcp__plugin_linear_linear__list_issue_labels
```

## Development Guidelines

### Agent Definition Structure

```markdown
---
name: agent-name
description: When to use this agent...
model: opus|sonnet|haiku
color: orange|cyan|blue|green|purple
tools:
  - mcp__plugin_serena_serena__*
  - mcp__plugin_linear_linear__*
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
