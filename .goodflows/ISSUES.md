# Deferred Issues

## High Priority
- [ ] **Executor integration for runWithAgent** - Currently returns invocation_created without executing; needs SDK executor integration for real agent execution
  - Discovered: 2026-01-11
  - Context: Fixed prompt and validation, but actual execution still requires external executor

## Normal Priority
- [ ] **Add tracking validation to plan-executor** - When subagents complete, validate they called tracking tools
  - Discovered: 2026-01-11
  - Context: Validation function exists in subagent-runner, needs integration in plan-executor

- [ ] **Archive old SUMMARY.md entries** - When SUMMARY.md exceeds size limit, archive oldest entries
  - Discovered: 2026-01-11
  - Context: Part of context engineering implementation

## Low Priority / Ideas
- [ ] **Add Mermaid diagram generation** - Auto-generate workflow diagrams from session data
- [ ] **Pattern confidence visualization** - Dashboard for pattern success rates
- [ ] **Multi-repo support** - Handle context across multiple repositories

## Resolved
- [x] **Agents exit without tracking** - Fixed by adding mandatory tracking instructions to prompts and agent files
  - Resolved: 2026-01-11
