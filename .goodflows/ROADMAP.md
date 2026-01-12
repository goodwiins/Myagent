# Roadmap

## Current Milestone
**Context Engineering** - In Progress

### Goals
- [ ] Create ContextFileManager class
- [ ] Create XML Task Parser
- [ ] Add MCP tools for context files
- [ ] Integrate with subagent prompts
- [ ] Add CLI commands
- [ ] Update agent files
- [x] Create implementation plan (PLAN.md)
- [x] Fix agent tracking enforcement

### Blockers
- None currently

---

## Completed Milestones

### v1.2.0 - Easy Tracking & LLM Handoff
- Added tracking helpers (trackFile, trackIssue, trackFinding)
- Added work units (startWork, completeWork)
- Added project/GitHub awareness
- Added LLM handoff capabilities (export, resume prompts)
- Added Linear sync and auto-indexing

### v1.1.0 - Session Context Manager
- Implemented session persistence
- Added checkpoints and rollback
- Added event timeline
- Added derived summaries

### v1.0.0 - Initial Release
- Agent registry
- Priority queue
- Context store with deduplication
- Pattern tracker

---

## Future Milestones

### Workflow Automation
- Pre-commit hooks for auto-review
- PR creation with findings summary
- Scheduled reviews

### IDE Integration
- VS Code extension
- Cursor integration
- Windsurf support
