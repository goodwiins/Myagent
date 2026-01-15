---
phase: 01-foundation
plan: 01
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
</success_criteria>
