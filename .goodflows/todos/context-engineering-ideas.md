# Context Engineering Ideas

## Captured
2026-01-11

## Ideas

### Auto-Context Detection
Could analyze the current task and automatically determine which context files to load:
- Code fix → Load STATE.md + PLAN.md
- Planning → Load ROADMAP.md + ISSUES.md
- New feature → Load PROJECT.md + ROADMAP.md

### Context File Versioning
Track changes to context files over time:
- Git integration for context file history
- Diff view between sessions
- Rollback to previous context state

### AI-Generated Summaries
After each session, use a cheap model (Haiku) to:
- Generate SUMMARY.md entry
- Update STATE.md with position
- Identify new ISSUES.md entries

### Context Health Dashboard
CLI command or web UI showing:
- File sizes vs limits (bar chart)
- Staleness indicators (last updated)
- Coverage metrics (which files exist)

## Related
- `.goodflows/PLAN.md` - Implementation plan
- `lib/context-files.js` - Future implementation
