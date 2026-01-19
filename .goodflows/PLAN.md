# Phase 06: Sync Collaboration Improvements

## Objective
Improve real-time collaboration between Claude, Gemini, and other LLMs with automatic sync, activity awareness, and conflict prevention.

## Problem Statement
Current sync workflow requires manual intervention:
1. User must explicitly call `goodflows_sync_export`
2. No awareness when another LLM exports context
3. No activity feed showing collaborative work
4. No automatic conflict detection before work starts

## Tasks

<tasks>

<task type="auto" id="task-01">
  <name>Add Activity Log to SyncManager</name>
  <context>
    <why>Users need visibility into what other LLMs have done</why>
    <dependencies>None</dependencies>
  </context>
  <scope>
    <files>
      <file action="modify">lib/sync-manager.js</file>
      <file action="create">lib/sync-activity.js</file>
    </files>
  </scope>
  <action>
    1. Create SyncActivity class to track LLM activities
    2. Log each export/import with timestamp, LLM, action, summary
    3. Add `getActivity(limit)` method to retrieve recent activity
    4. Add `goodflows_sync_activity` MCP tool
  </action>
  <verify>npm test -- tests/unit/sync-manager.test.js</verify>
  <done>Activity log shows recent exports/imports from all LLMs</done>
</task>

<task type="auto" id="task-02">
  <name>Auto-Export on Session End</name>
  <context>
    <why>Reduce manual steps for collaboration</why>
    <dependencies>task-01</dependencies>
  </context>
  <scope>
    <files>
      <file action="modify">lib/session-context.js</file>
      <file action="modify">bin/mcp/handlers/session.js</file>
    </files>
  </scope>
  <action>
    1. Add `autoExport` option to session config
    2. On session end, automatically call sync export if enabled
    3. Include session summary in export message
    4. Add CLI flag: `--auto-sync` or config option
  </action>
  <verify>npm test -- tests/unit/session-context.test.js</verify>
  <done>Sessions auto-export context when ending (if enabled)</done>
</task>

<task type="auto" id="task-03">
  <name>Sync Status Dashboard Enhancement</name>
  <context>
    <why>Quick visibility into collaboration state</why>
    <dependencies>task-01</dependencies>
  </context>
  <scope>
    <files>
      <file action="modify">lib/sync-manager.js</file>
      <file action="modify">bin/mcp/handlers/sync.js</file>
    </files>
  </scope>
  <action>
    1. Enhance `status()` to include activity summary
    2. Show time since last export for each LLM
    3. Add "freshness" indicator (fresh/stale/outdated)
    4. Include brief summary of what each LLM was working on
  </action>
  <verify>npm test -- tests/unit/sync-manager.test.js</verify>
  <done>Status shows activity, freshness, and work summaries</done>
</task>

</tasks>

## Success Criteria
- [ ] Activity log captures all sync events
- [ ] Auto-export works on session end
- [ ] Status dashboard shows collaboration overview
- [ ] All tests pass

## Verification
```bash
npm test
npm run lint:check
```
