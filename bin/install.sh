#!/bin/bash
# GoodFlows Installation Script
# Usage: ./install.sh /path/to/target-project

set -e

GOODFLOWS_DIR="$(cd "$(dirname "$0")/.." && pwd)"
TARGET_DIR="${1:-.}"

# Resolve to absolute path
TARGET_DIR="$(cd "$TARGET_DIR" 2>/dev/null && pwd || echo "$TARGET_DIR")"

echo "Installing GoodFlows to: $TARGET_DIR"
echo "From: $GOODFLOWS_DIR"
echo ""

# Create directories
mkdir -p "$TARGET_DIR/.claude"
mkdir -p "$TARGET_DIR/.goodflows"
mkdir -p "$TARGET_DIR/agents"

# 1. Copy agent files
echo "Copying agent files..."
cp "$GOODFLOWS_DIR/agents/"*.md "$TARGET_DIR/agents/" 2>/dev/null || true
echo "  - agents/*.md"

# 2. Copy/merge CLAUDE.md
if [ -f "$TARGET_DIR/CLAUDE.md" ]; then
  echo "CLAUDE.md exists - appending GoodFlows section..."
  if ! grep -q "GoodFlows" "$TARGET_DIR/CLAUDE.md"; then
    echo "" >> "$TARGET_DIR/CLAUDE.md"
    echo "# GoodFlows Integration" >> "$TARGET_DIR/CLAUDE.md"
    echo "" >> "$TARGET_DIR/CLAUDE.md"
    echo "This project uses GoodFlows for automated code review and issue tracking." >> "$TARGET_DIR/CLAUDE.md"
    echo "See \`agents/\` directory for available agents." >> "$TARGET_DIR/CLAUDE.md"
    echo "" >> "$TARGET_DIR/CLAUDE.md"
    echo "## Quick Commands" >> "$TARGET_DIR/CLAUDE.md"
    echo "- \`goodflows_session_start()\` - Start tracking session" >> "$TARGET_DIR/CLAUDE.md"
    echo "- \`goodflows_context_file_status()\` - Check context health" >> "$TARGET_DIR/CLAUDE.md"
    echo "- \`goodflows_plan_parse()\` - Parse current task from PLAN.md" >> "$TARGET_DIR/CLAUDE.md"
  fi
else
  echo "Creating CLAUDE.md..."
  cat > "$TARGET_DIR/CLAUDE.md" << 'EOF'
# Project Instructions

## GoodFlows Integration

This project uses GoodFlows for automated code review and issue tracking.
See `agents/` directory for available agents.

## Quick Commands
- `goodflows_session_start()` - Start tracking session
- `goodflows_context_file_status()` - Check context health
- `goodflows_plan_parse()` - Parse current task from PLAN.md

## Agents
- `review-orchestrator` - Full code review workflow
- `issue-creator` - Create Linear issues from findings
- `coderabbit-auto-fixer` - Apply fixes automatically
- `plan-orchestrator` - Split complex tasks into subtasks
EOF
fi
echo "  - CLAUDE.md"

# 3. Create Claude settings
echo "Creating Claude settings..."
cat > "$TARGET_DIR/.claude/settings.local.json" << EOF
{
  "mcpServers": {
    "goodflows": {
      "command": "node",
      "args": ["$GOODFLOWS_DIR/bin/mcp-server.js"]
    }
  }
}
EOF
echo "  - .claude/settings.local.json"

# 4. Initialize context files (templates)
echo "Initializing context files..."

# PROJECT.md - create template if not exists
if [ ! -f "$TARGET_DIR/.goodflows/PROJECT.md" ]; then
  PROJECT_NAME=$(basename "$TARGET_DIR")
  cat > "$TARGET_DIR/.goodflows/PROJECT.md" << EOF
# Project: $PROJECT_NAME

## Vision
[Describe what this project does]

## Core Principles
- [Principle 1]
- [Principle 2]

## Architecture
[High-level architecture description]

## Key Technologies
- [Tech 1]: [Why]

## Boundaries
- DO: [What the project does]
- DON'T: [What it doesn't do]
EOF
  echo "  - .goodflows/PROJECT.md (template)"
fi

# STATE.md
if [ ! -f "$TARGET_DIR/.goodflows/STATE.md" ]; then
  cat > "$TARGET_DIR/.goodflows/STATE.md" << EOF
# Current State

## Last Updated
$(date -u +"%Y-%m-%dT%H:%M:%SZ")

## Active Session
- ID: none
- Started: -
- Trigger: -

## Current Position
No active work.

## Recent Decisions
| Decision | Rationale | Date |
|----------|-----------|------|

## Active Blockers
- None

## Context for Next Session
[To be filled]
EOF
  echo "  - .goodflows/STATE.md (template)"
fi

# PLAN.md
if [ ! -f "$TARGET_DIR/.goodflows/PLAN.md" ]; then
  cat > "$TARGET_DIR/.goodflows/PLAN.md" << EOF
<task type="implementation">
  <name>Define your task here</name>

  <context>
    <why>Why this task matters</why>
  </context>

  <scope>
    <files>
      <file action="modify">path/to/file</file>
    </files>
  </scope>

  <action>
    Steps to complete:
    1. Step one
    2. Step two
  </action>

  <verify>
    <check type="command">npm test</check>
  </verify>

  <done>
    Definition of done
  </done>

  <tracking>
    <goodflows>true</goodflows>
  </tracking>
</task>
EOF
  echo "  - .goodflows/PLAN.md (template)"
fi

# ROADMAP.md
if [ ! -f "$TARGET_DIR/.goodflows/ROADMAP.md" ]; then
  cat > "$TARGET_DIR/.goodflows/ROADMAP.md" << EOF
# Roadmap

## Current Milestone
**[Milestone Name]** - In Progress

### Goals
- [ ] Goal 1
- [ ] Goal 2

### Blockers
- None

---

## Completed Milestones
*None yet*

---

## Future Milestones
- [Future work]
EOF
  echo "  - .goodflows/ROADMAP.md (template)"
fi

# SUMMARY.md
if [ ! -f "$TARGET_DIR/.goodflows/SUMMARY.md" ]; then
  cat > "$TARGET_DIR/.goodflows/SUMMARY.md" << EOF
# Execution Summary

## Latest Execution
**Date**: -
**Task**: -
**Status**: -

### Changes Made
- None yet

### Notes
-

---

## Previous Executions
*None*
EOF
  echo "  - .goodflows/SUMMARY.md (template)"
fi

# ISSUES.md
if [ ! -f "$TARGET_DIR/.goodflows/ISSUES.md" ]; then
  cat > "$TARGET_DIR/.goodflows/ISSUES.md" << EOF
# Deferred Issues

## High Priority
*None*

## Normal Priority
*None*

## Low Priority / Ideas
*None*

## Resolved
*None*
EOF
  echo "  - .goodflows/ISSUES.md (template)"
fi

echo ""
echo "Installation complete!"
echo ""
echo "Next steps:"
echo "  1. Restart Claude Code to load the MCP server"
echo "  2. Edit .goodflows/PROJECT.md with your project info"
echo "  3. Run: goodflows_context_file_status() to verify"
echo ""
