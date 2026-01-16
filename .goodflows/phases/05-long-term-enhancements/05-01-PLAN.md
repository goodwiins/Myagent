---
phase: 05-long-term-enhancements
plan: 01
type: execute
depends_on: [04-short-term-improvements]
files_modified: []
---

<objective>
Split large TypeScript definition file and implement context engineering improvements

Purpose: Improve maintainability, enable smart context loading, and provide visibility into context health
Output: Modular type files, auto-context detection, context health dashboard
</objective>

<execution_context>
@.goodflows/workflows/execute-plan.md
@.goodflows/todos/context-engineering-ideas.md
</execution_context>

<context>
@types/index.d.ts
@lib/context-files.js
</context>

<tasks>

<task type="auto" id="task-1">
  <name>GOO-145: Split TypeScript definition file</name>
  <files>types/index.d.ts, types/sdk.d.ts, types/context.d.ts, types/gsd.d.ts, types/mcp.d.ts</files>
  <action>
    Split the 1100+ line types/index.d.ts into modular files:

    1. Create types/sdk.d.ts:
       - Agent SDK types
       - Tool definitions
       - Hook interfaces

    2. Create types/context.d.ts:
       - SessionContextManager types
       - Context store types
       - Finding and pattern types

    3. Create types/gsd.d.ts:
       - GSD executor types
       - Phase and plan types
       - Task and verification types

    4. Create types/mcp.d.ts:
       - MCP tool input/output types
       - Handler types

    5. Update types/index.d.ts:
       - Re-export all types from modular files
       - Maintain backward compatibility
  </action>
  <verify>npx tsc --noEmit</verify>
  <done>Types split into 4+ files, all imports still work</done>
</task>

<task type="auto" id="task-2">
  <name>Implement auto-context detection</name>
  <files>lib/context-files.js, lib/auto-context.js</files>
  <action>
    Create intelligent context loading based on task type:

    1. Create lib/auto-context.js with detectContextNeeds(task):
       - Parse task description for keywords
       - Map keywords to context files:
         * "fix", "bug", "error" → STATE.md + PLAN.md
         * "plan", "design", "architect" → ROADMAP.md + ISSUES.md
         * "new feature", "implement" → PROJECT.md + ROADMAP.md
         * "review", "test" → STATE.md + SUMMARY.md

    2. Add autoLoadContext(task) function:
       - Call detectContextNeeds()
       - Load only required files
       - Stay within 6K token budget

    3. Integrate with goodflows_autoload_context MCP tool
  </action>
  <verify>npm test -- tests/unit/auto-context.test.js</verify>
  <done>Auto-context detection working, reduces token usage by 30%+</done>
</task>

<task type="auto" id="task-3">
  <name>Create context health dashboard</name>
  <files>lib/context-health.js, bin/cli/health.js</files>
  <action>
    Create CLI dashboard showing context health:

    1. Create lib/context-health.js:
       - getFileSizes() - current size of each context file
       - getFileLimits() - token limits from spec
       - calculateHealth() - percentage of limit used
       - getStaleness() - days since last update
       - getCoverage() - which files exist

    2. Create bin/cli/health.js:
       - goodflows health command
       - Display bar chart of file sizes vs limits
       - Color coding: green (<70%), yellow (70-90%), red (>90%)
       - Show staleness indicators
       - Suggest cleanup actions

    3. Add MCP tool:
       - goodflows_context_health()
       - Returns JSON with all metrics
  </action>
  <verify>goodflows health</verify>
  <done>Health dashboard showing all context metrics</done>
</task>

</tasks>

<verification>
Before declaring complete:
- [ ] TypeScript compilation passes
- [ ] Auto-context detection reduces token usage
- [ ] Health dashboard displays correctly
- [ ] All tests pass
</verification>

<success_criteria>
- GOO-145 resolved (type file split)
- Auto-context detection saves 30%+ tokens
- Health dashboard provides visibility
- Documentation updated
</success_criteria>
