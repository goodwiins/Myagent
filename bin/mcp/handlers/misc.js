/**
 * GoodFlows MCP Miscellaneous Handlers
 *
 * Handles: stats, project_info, export_handoff, import_handoff, generate_resume_prompt,
 * sync_linear, resolve_linear_team, auto_index, preflight_check,
 * context_file_read, context_file_write, context_file_status, context_file_init,
 * state_update, summary_add, summary_create, autoload_context
 *
 * @module goodflows/bin/mcp/handlers/misc
 */

import { existsSync } from 'fs';
import { join } from 'path';
import { mcpResponse, mcpError } from '../tool-registry.js';

/**
 * Misc Tool Definitions
 */
export const tools = [
  // ========== Stats Tool ==========
  {
    name: 'goodflows_stats',
    description: 'Get overall GoodFlows statistics',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },

  // ========== Project Info Tool ==========
  {
    name: 'goodflows_project_info',
    description: `Get project and GitHub repository information.

Returns:
- Project name, version, description (from package.json)
- GitHub owner, repo, URL (from git remote)
- Current branch and default branch
- Working directory

Use this to understand the current project context.`,
    inputSchema: {
      type: 'object',
      properties: {
        refresh: {
          type: 'boolean',
          description: 'Force refresh cached info (default: false)',
        },
      },
    },
  },

  // ========== LLM Handoff Tools ==========
  {
    name: 'goodflows_export_handoff',
    description: `Export current GoodFlows state for LLM/IDE handoff.

Use this when switching between LLMs (Claude → GPT-4 → Gemini) or IDEs (Cursor → VS Code → Windsurf).
Returns everything needed for another LLM to resume work seamlessly.

Returns:
- Project and GitHub context
- Active sessions with their state
- Recent findings and issues
- Current work in progress
- Resume instructions`,
    inputSchema: {
      type: 'object',
      properties: {
        sessionId: {
          type: 'string',
          description: 'Specific session to export (optional, exports all active if not specified)',
        },
        includeFindings: {
          type: 'boolean',
          description: 'Include recent findings (default: true)',
        },
        findingsLimit: {
          type: 'number',
          description: 'Max findings to include (default: 20)',
        },
      },
    },
  },
  {
    name: 'goodflows_import_handoff',
    description: `Import a GoodFlows context handoff from another environment.

Restores session state, findings, and project context.
Use this when picking up work started in another tool (e.g. CLI -> IDE).

Effects:
- Restores session files to .goodflows/context/sessions/
- Restores findings to context store
- Runs post-handoff hooks (e.g. npm install)`,
    inputSchema: {
      type: 'object',
      properties: {
        content: {
          type: 'string',
          description: 'The JSON content string returned by goodflows_export_handoff',
        },
        sessionId: {
          type: 'string',
          description: 'Optional: Force a specific session ID for the import',
        },
      },
      required: ['content'],
    },
  },
  {
    name: 'goodflows_generate_resume_prompt',
    description: `Generate a prompt for another LLM to resume work.

Creates a ready-to-paste prompt that gives any LLM full context to continue where you left off.
Works with Claude, GPT-4, Gemini, or any other model.

The generated prompt includes:
- Project context and current state
- Active work and progress
- What was done and what remains
- Specific instructions for resuming`,
    inputSchema: {
      type: 'object',
      properties: {
        sessionId: {
          type: 'string',
          description: 'Session to generate prompt for',
        },
        style: {
          type: 'string',
          enum: ['concise', 'detailed', 'technical'],
          description: 'Prompt style (default: concise)',
        },
        includeFiles: {
          type: 'boolean',
          description: 'Include list of modified files (default: true)',
        },
      },
    },
  },

  // ========== Linear Sync Tools ==========
  {
    name: 'goodflows_sync_linear',
    description: `Sync issues from Linear to the context store. Automatically indexes Linear issues as findings.

Two modes:
1. Pass pre-fetched issues (preferred): First fetch via Linear MCP, then pass here
2. Direct API call: Requires LINEAR_API_KEY environment variable

Examples:
- With pre-fetched issues: { "issues": [...issues from linear MCP...] }
- Direct API call: { "team": "GOO", "status": "open" }`,
    inputSchema: {
      type: 'object',
      properties: {
        issues: {
          type: 'array',
          description: 'Pre-fetched issues from Linear MCP server (preferred method)',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              identifier: { type: 'string' },
              title: { type: 'string' },
              description: { type: 'string' },
              state: { type: 'object' },
              labels: { type: 'array' },
            },
          },
        },
        team: { type: 'string', description: 'Linear team key for direct API call (e.g., "GOO")' },
        status: { type: 'string', description: 'Filter by status: open, in_progress, done' },
        labels: { type: 'array', items: { type: 'string' }, description: 'Filter by labels' },
        limit: { type: 'number', description: 'Max issues to sync (default: 50)' },
        since: { type: 'string', description: 'ISO date - only sync issues created after this date' },
      },
    },
  },
  {
    name: 'goodflows_resolve_linear_team',
    description: `Resolve a Linear team from key, name, or ID.

CRITICAL: Always use this before creating issues to ensure valid team name.

The team input might be:
- A team key (e.g., "GOO") - the prefix used in issue IDs like GOO-82
- A team name (e.g., "Goodwiinz") - the actual team name in Linear
- A team UUID - the internal Linear ID

Returns the resolved team with id, name, and key for use in create_issue calls.

Example:
- Input: { "team": "GOO" }
- Output: { "resolved": true, "id": "uuid", "name": "Goodwiinz", "key": "GOO" }`,
    inputSchema: {
      type: 'object',
      properties: {
        team: { type: 'string', description: 'Team key, name, or ID to resolve' },
        teams: {
          type: 'array',
          description: 'Pre-fetched teams from linear_list_teams (optional, avoids extra API call)',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              name: { type: 'string' },
              key: { type: 'string' },
            },
          },
        },
      },
      required: ['team'],
    },
  },
  {
    name: 'goodflows_auto_index',
    description: `Enable or configure automatic indexing of findings.

When enabled, findings are automatically indexed when:
- Issues are created via Linear MCP
- Code reviews complete
- Fixes are applied`,
    inputSchema: {
      type: 'object',
      properties: {
        enabled: { type: 'boolean', description: 'Enable/disable auto-indexing' },
        sources: {
          type: 'array',
          items: { type: 'string' },
          description: 'Sources to auto-index: linear, coderabbit, fixes',
        },
        sessionId: { type: 'string', description: 'Session to attach auto-indexed findings to' },
      },
    },
  },

  // ========== Preflight Check Tool ==========
  {
    name: 'goodflows_preflight_check',
    description: `Check for conflicts with existing Linear issues before taking action.

MUST be called before:
- Creating issues (prevents duplicates)
- Applying fixes (ensures issue still relevant)
- Running reviews (skips known issues)

Caches Linear issues for the session (5 min TTL) to avoid repeated API calls.

Returns:
- status: "clear" | "conflicts_found" | "error"
- conflicts: Findings that match existing issues (with match type and similarity)
- clear: Findings safe to proceed with
- requiresConfirmation: true if user decision needed

When conflicts are found, the agent should prompt the user with options:
- Skip conflicts: Only process clear findings
- Link to existing: Add comments to existing issues
- Force create: Create anyway (marked as potential duplicate)
- Abort: Stop workflow

Example:
{
  "action": "create_issue",
  "findings": [{ "file": "src/auth.ts", "description": "Missing validation" }],
  "sessionId": "session_xxx",
  "team": "Goodwiinz",
  "linearIssues": [...] // Pre-fetched from linear_list_issues
}`,
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['create_issue', 'fix_issue', 'review'],
          description: 'What action you intend to take',
        },
        findings: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              file: { type: 'string', description: 'File path' },
              description: { type: 'string', description: 'Finding description' },
              type: { type: 'string', description: 'Finding type' },
            },
          },
          description: 'Findings/actions you intend to process',
        },
        sessionId: { type: 'string', description: 'Session ID for caching' },
        team: { type: 'string', description: 'Linear team name (resolved, not key)' },
        linearIssues: {
          type: 'array',
          description: 'Pre-fetched issues from linear_list_issues (recommended to avoid extra API calls)',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              identifier: { type: 'string' },
              title: { type: 'string' },
              description: { type: 'string' },
              status: { type: 'string' },
              url: { type: 'string' },
            },
          },
        },
        options: {
          type: 'object',
          properties: {
            similarityThreshold: { type: 'number', description: 'Similarity threshold 0-1 (default: 0.5)' },
            includeInProgress: { type: 'boolean', description: 'Include in-progress issues (default: true)' },
            includeDone: { type: 'boolean', description: 'Include done issues (default: false)' },
            forceRefresh: { type: 'boolean', description: 'Bypass cache and refresh (default: false)' },
          },
        },
      },
      required: ['action', 'findings', 'sessionId'],
    },
  },

  // ========== Context File Tools ==========
  {
    name: 'goodflows_context_file_read',
    description: `Read a structured context file (PROJECT, ROADMAP, STATE, PLAN, SUMMARY, ISSUES).

These files provide persistent context for Claude agents:
- PROJECT.md: Project vision (always loaded, 2K token limit)
- ROADMAP.md: Goals and milestones (3K token limit)
- STATE.md: Session memory across contexts (1.5K token limit)
- PLAN.md: Current atomic task in XML format (1K token limit)
- SUMMARY.md: Execution history (5K token limit)
- ISSUES.md: Deferred work queue (2K token limit)`,
    inputSchema: {
      type: 'object',
      properties: {
        file: {
          type: 'string',
          enum: ['PROJECT', 'ROADMAP', 'STATE', 'PLAN', 'SUMMARY', 'ISSUES'],
          description: 'Context file type to read',
        },
      },
      required: ['file'],
    },
  },
  {
    name: 'goodflows_context_file_write',
    description: `Write to a structured context file. Enforces size limits.

Size limits (in tokens):
- PROJECT: 2000
- ROADMAP: 3000
- STATE: 1500
- PLAN: 1000
- SUMMARY: 5000
- ISSUES: 2000`,
    inputSchema: {
      type: 'object',
      properties: {
        file: {
          type: 'string',
          enum: ['PROJECT', 'ROADMAP', 'STATE', 'PLAN', 'SUMMARY', 'ISSUES'],
          description: 'Context file type to write',
        },
        content: { type: 'string', description: 'Content to write' },
        allowOversize: { type: 'boolean', description: 'Allow exceeding size limit (default: false)' },
      },
      required: ['file', 'content'],
    },
  },
  {
    name: 'goodflows_context_file_status',
    description: 'Get status of all context files (sizes, limits, health score)',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'goodflows_context_file_init',
    description: 'Initialize context file structure with templates. Creates .goodflows/ directory and all context files.',
    inputSchema: {
      type: 'object',
      properties: {
        force: { type: 'boolean', description: 'Overwrite existing files (default: false)' },
      },
    },
  },
  {
    name: 'goodflows_state_update',
    description: `Update STATE.md with new information. Handles structured updates.

Updates can include:
- session: { id, started, trigger }
- position: Current work position text
- decision: { decision, rationale }
- nextContext: Context for next session`,
    inputSchema: {
      type: 'object',
      properties: {
        session: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            started: { type: 'string' },
            trigger: { type: 'string' },
          },
        },
        position: { type: 'string', description: 'Current work position' },
        decision: {
          type: 'object',
          properties: {
            decision: { type: 'string' },
            rationale: { type: 'string' },
          },
        },
        nextContext: { type: 'string', description: 'Context for next session' },
      },
    },
  },
  {
    name: 'goodflows_summary_add',
    description: 'Add an execution entry to SUMMARY.md. Auto-archives old entries.',
    inputSchema: {
      type: 'object',
      properties: {
        task: { type: 'string', description: 'Task name' },
        status: { type: 'string', enum: ['success', 'partial', 'failed'], description: 'Execution status' },
        changes: { type: 'array', items: { type: 'string' }, description: 'List of changes made' },
        verification: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              passed: { type: 'boolean' },
            },
          },
        },
        notes: { type: 'string', description: 'Additional notes' },
      },
      required: ['task', 'status'],
    },
  },
  {
    name: 'goodflows_summary_create',
    description: `Create a SUMMARY.md for a completed plan.

Documents what was accomplished, task commits, deviations, and metrics.`,
    inputSchema: {
      type: 'object',
      properties: {
        phase: { type: ['number', 'string'], description: 'Phase number or name' },
        planNumber: { type: 'number', description: 'Plan number' },
        taskCommits: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              hash: { type: 'string' },
              type: { type: 'string', enum: ['feat', 'fix', 'test', 'refactor', 'perf', 'chore', 'docs'] },
            },
          },
          description: 'Array of task commit info',
        },
        accomplishments: {
          type: 'array',
          items: { type: 'string' },
          description: 'Key accomplishments',
        },
        deviations: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              type: { type: 'string', enum: ['auto-fix', 'deferred'] },
              rule: { type: 'number' },
              category: { type: 'string' },
              description: { type: 'string' },
              task: { type: 'string' },
              issue: { type: 'string' },
              fix: { type: 'string' },
              verification: { type: 'string' },
              commitHash: { type: 'string' },
            },
          },
          description: 'Deviations from plan',
        },
        metrics: {
          type: 'object',
          properties: {
            duration: { type: 'string' },
            startedAt: { type: 'string' },
            filesModified: { type: 'number' },
            oneLiner: { type: 'string' },
            metadataCommit: { type: 'string' },
            subsystem: { type: 'string' },
            tags: { type: 'array', items: { type: 'string' } },
            keyFiles: {
              type: 'object',
              properties: {
                created: { type: 'array', items: { type: 'string' } },
                modified: { type: 'array', items: { type: 'string' } },
              },
            },
            keyDecisions: { type: 'array', items: { type: 'string' } },
            nextPhaseReadiness: { type: 'string' },
          },
          description: 'Performance metrics and metadata',
        },
      },
      required: ['phase', 'planNumber'],
    },
  },
  {
    name: 'goodflows_autoload_context',
    description: `Get auto-load context for agent prompts.

Returns combined content from context files based on options:
- Always loads: PROJECT.md, STATE.md
- On planning: Also loads ROADMAP.md, ISSUES.md
- On task: Also loads PLAN.md
- For orchestrators: Also loads SUMMARY.md

Respects a 6K token budget for auto-loaded context.`,
    inputSchema: {
      type: 'object',
      properties: {
        agentType: { type: 'string', description: 'Agent type (e.g., orchestrator, fixer)' },
        isPlanning: { type: 'boolean', description: 'Whether in planning phase' },
        hasTask: { type: 'boolean', description: 'Whether there is an active task' },
      },
    },
  },
];

/**
 * Misc Handlers
 */
export const handlers = {
  async goodflows_stats(args, services) {
    const { contextStore, patternTracker, activeSessions, activeQueues, autoIndexConfig, getProjectContext } = services;

    const contextStats = contextStore.getStats();
    const patternStats = patternTracker.getStats();
    const projectContext = getProjectContext();

    return mcpResponse({
      project: {
        name: projectContext.project.name,
        version: projectContext.project.version,
      },
      github: {
        owner: projectContext.github.owner,
        repo: projectContext.github.repo,
        branch: projectContext.github.branch,
        url: projectContext.github.url,
      },
      context: contextStats,
      patterns: patternStats,
      activeSessions: activeSessions.size,
      activeQueues: activeQueues.size,
      autoIndex: autoIndexConfig,
    });
  },

  async goodflows_project_info(args, services) {
    const { getProjectContext, refreshProjectInfo } = services;

    if (args.refresh) {
      refreshProjectInfo();
    }

    const context = getProjectContext();
    return mcpResponse(context);
  },

  async goodflows_export_handoff(args, services) {
    const { activeSessions, contextStore, getProjectContext, goodflowsBasePath } = services;

    // Run pre-handoff hook if exists
    const preHookPath = join(process.cwd(), 'bin', 'hooks', 'pre-handoff.js');
    if (existsSync(preHookPath)) {
      try {
        const { execSync } = await import('child_process');
        execSync(`node "${preHookPath}"`, { stdio: 'inherit' });
      } catch (e) {
        console.error('Warning: Pre-handoff hook failed:', e.message);
      }
    }

    const projectContext = getProjectContext();
    const includeFindings = args.includeFindings !== false;
    const findingsLimit = args.findingsLimit || 20;

    // Collect session data
    const sessions = [];
    if (args.sessionId) {
      const session = activeSessions.get(args.sessionId);
      if (session) {
        sessions.push({
          id: args.sessionId,
          state: session.getState(),
          metadata: session.session?.metadata,
          stats: session.getStats(),
          currentWork: session.getCurrentWork(),
          completedWork: session.getCompletedWork(),
          tracking: session.getTrackingSummary(),
          recentEvents: session.getEvents().slice(-10),
          rawContext: session.session?.context,
        });
      }
    } else {
      for (const [id, session] of activeSessions) {
        sessions.push({
          id,
          state: session.getState(),
          metadata: session.session?.metadata,
          stats: session.getStats(),
          currentWork: session.getCurrentWork(),
          completedWork: session.getCompletedWork(),
          tracking: session.getTrackingSummary(),
          recentEvents: session.getEvents().slice(-10),
          rawContext: session.session?.context,
        });
      }
    }

    // Get recent findings
    let findings = [];
    if (includeFindings) {
      const allFindings = contextStore.query({ limit: findingsLimit });
      findings = allFindings.map(f => ({
        type: f.type,
        file: f.file,
        description: f.description,
        status: f.status,
        issueId: f.issueId,
        lines: f.lines,
        severity: f.severity,
        _hash: f._hash,
      }));
    }

    const handoff = {
      exportedAt: new Date().toISOString(),
      project: {
        name: projectContext.project.name,
        version: projectContext.project.version,
        description: projectContext.project.description,
      },
      github: {
        url: projectContext.github.url,
        owner: projectContext.github.owner,
        repo: projectContext.github.repo,
        branch: projectContext.github.branch,
      },
      sessions,
      findings,
      stats: {
        totalSessions: sessions.length,
        totalFindings: findings.length,
        contextStats: contextStore.getStats(),
      },
      resumeInstructions: [
        'Configure GoodFlows MCP server in your IDE',
        'Run: goodflows_project_info() to verify connection',
        'Run: goodflows_import_handoff({ content: <JSON> }) to restore state',
        sessions.length > 0
          ? `Resume session: goodflows_session_resume({ sessionId: "${sessions[0]?.id}" })`
          : 'Start new session: goodflows_session_start({ trigger: "handoff-resume" })',
        'Use goodflows_get_tracking_summary() to see current progress',
      ],
    };

    return mcpResponse(handoff);
  },

  async goodflows_import_handoff(args, services) {
    const { contextStore, goodflowsBasePath } = services;

    try {
      const content = typeof args.content === 'string'
        ? JSON.parse(args.content)
        : args.content;

      // 1. Restore sessions
      const restoredSessions = [];
      if (content.sessions && Array.isArray(content.sessions)) {
        const { writeFileSync, mkdirSync } = await import('fs');
        const sessionsDir = join(goodflowsBasePath, 'context', 'sessions');
        mkdirSync(sessionsDir, { recursive: true });

        for (const sessionData of content.sessions) {
          const sessionId = args.sessionId || sessionData.id;

          const fullSession = {
            id: sessionId,
            state: sessionData.state || 'running',
            metadata: sessionData.metadata || {},
            timestamps: {
              created: new Date().toISOString(),
              started: new Date().toISOString(),
              updated: new Date().toISOString(),
            },
            context: sessionData.rawContext || {},
            invocations: [],
            events: sessionData.recentEvents || [],
            checkpoints: [],
            stats: sessionData.stats || {},
            tracking: {
              files: { created: [], modified: [], deleted: [] },
              issues: { created: [], fixed: [], skipped: [], failed: [] },
              findings: [],
              work: sessionData.completedWork || [],
              currentWork: sessionData.currentWork || null,
              plans: { active: null, completed: [], history: [] },
            },
          };

          const sessionPath = join(sessionsDir, `${sessionId}.json`);
          writeFileSync(sessionPath, JSON.stringify(fullSession, null, 2));
          restoredSessions.push(sessionId);
        }
      }

      // 2. Restore findings
      let findingsRestored = 0;
      if (content.findings && Array.isArray(content.findings)) {
        for (const finding of content.findings) {
          contextStore.addFinding(finding);
          findingsRestored++;
        }
      }

      // 3. Run post-handoff hook
      const postHookPath = join(process.cwd(), 'bin', 'hooks', 'post-handoff.js');
      let hookResult = 'skipped';
      if (existsSync(postHookPath)) {
        try {
          const { execSync } = await import('child_process');
          execSync(`node "${postHookPath}"`, { stdio: 'inherit' });
          hookResult = 'success';
        } catch (e) {
          hookResult = `failed: ${e.message}`;
        }
      }

      return mcpResponse({
        success: true,
        sessionsRestored: restoredSessions,
        findingsRestored,
        hookStatus: hookResult,
        nextSteps: restoredSessions.length > 0
          ? `Resume with: goodflows_session_resume({ sessionId: "${restoredSessions[0]}" })`
          : 'Start new session: goodflows_session_start()',
      });
    } catch (error) {
      return mcpError(`Import failed: ${error.message}`, 'IMPORT_ERROR');
    }
  },

  async goodflows_generate_resume_prompt(args, services) {
    const { activeSessions, contextStore, getProjectContext } = services;

    const projectContext = getProjectContext();
    const style = args.style || 'concise';
    const includeFiles = args.includeFiles !== false;

    let sessionData = null;
    let trackingSummary = null;
    let currentWork = null;
    let completedWork = [];

    if (args.sessionId) {
      const session = activeSessions.get(args.sessionId);
      if (session) {
        sessionData = {
          id: args.sessionId,
          state: session.getState(),
          metadata: session.session?.metadata,
          stats: session.getStats(),
        };
        trackingSummary = session.getTrackingSummary();
        currentWork = session.getCurrentWork();
        completedWork = session.getCompletedWork();
      }
    }

    const recentFindings = contextStore.query({ status: 'open', limit: 5 });

    let prompt = '';

    if (style === 'concise') {
      prompt = `# Resume Context

## Project
- **Name**: ${projectContext.project.name} (v${projectContext.project.version || 'unknown'})
- **Repo**: ${projectContext.github.url || 'local'}
- **Branch**: ${projectContext.github.branch || 'unknown'}

## Current State
${sessionData ? `- **Session**: ${sessionData.id} (${sessionData.state})
- **Trigger**: ${sessionData.metadata?.trigger || 'unknown'}` : '- No active session'}
${currentWork ? `- **Active Work**: ${currentWork.type} - ${currentWork.metadata?.issueId || currentWork.metadata?.title || 'in progress'}` : ''}

## Progress
${trackingSummary ? `- Files: ${trackingSummary.filesCreated} created, ${trackingSummary.filesModified} modified
- Issues: ${trackingSummary.issuesFixed} fixed, ${trackingSummary.issuesSkipped} skipped` : '- No tracking data'}

## Open Issues
${recentFindings.length > 0 ? recentFindings.map(f => `- [${f.type}] ${f.description?.slice(0, 60)}...`).join('\n') : '- None'}

## Resume Instructions
1. Run \`goodflows_project_info()\` to verify context
${sessionData ? `2. Resume: \`goodflows_session_resume({ sessionId: "${sessionData.id}" })\`` : '2. Start: `goodflows_session_start({ trigger: "handoff" })`'}
3. Check progress: \`goodflows_get_tracking_summary()\`
`;
    } else if (style === 'detailed') {
      prompt = `# Context Handoff - Resume Work

## Project Information
You are resuming work on **${projectContext.project.name}**${projectContext.project.version ? ` version ${projectContext.project.version}` : ''}.

${projectContext.project.description ? `**Description**: ${projectContext.project.description}\n` : ''}
**Repository**: ${projectContext.github.url || 'Local repository'}
**Current Branch**: ${projectContext.github.branch || 'unknown'}
**Owner**: ${projectContext.github.owner || 'unknown'}

## Session State
${sessionData ? `
An active session exists:
- **Session ID**: ${sessionData.id}
- **State**: ${sessionData.state}
- **Trigger**: ${sessionData.metadata?.trigger || 'manual'}
- **Project**: ${sessionData.metadata?.project || projectContext.project.name}
- **GitHub**: ${sessionData.metadata?.github || projectContext.github.url}
` : 'No active session found. Start a new one with `goodflows_session_start()`.'}

## Work Progress
${currentWork ? `
**Currently Working On**:
- Type: ${currentWork.type}
- Started: ${currentWork.startedAt}
${currentWork.metadata?.issueId ? `- Issue: ${currentWork.metadata.issueId}` : ''}
${currentWork.metadata?.title ? `- Title: ${currentWork.metadata.title}` : ''}
` : 'No active work unit.'}

${completedWork.length > 0 ? `
**Completed Work Units** (${completedWork.length}):
${completedWork.slice(-3).map(w => `- ${w.type}: ${w.summary?.filesCreated || 0} files created, ${w.summary?.issuesFixed || 0} issues fixed`).join('\n')}
` : ''}

## Tracking Summary
${trackingSummary ? `
| Metric | Count |
|--------|-------|
| Files Created | ${trackingSummary.filesCreated} |
| Files Modified | ${trackingSummary.filesModified} |
| Issues Created | ${trackingSummary.issuesCreated} |
| Issues Fixed | ${trackingSummary.issuesFixed} |
| Issues Skipped | ${trackingSummary.issuesSkipped} |
| Findings Processed | ${trackingSummary.findingsProcessed} |
` : 'No tracking data available.'}

${includeFiles && trackingSummary?.filesTotal > 0 ? `
## Modified Files
Use \`goodflows_get_tracking_summary()\` to see the list of files.
` : ''}

## Open Findings
${recentFindings.length > 0 ? recentFindings.map(f => `
### ${f.issueId || 'Finding'} [${f.type}]
- **File**: ${f.file}
- **Status**: ${f.status}
- **Description**: ${f.description?.slice(0, 100)}${f.description?.length > 100 ? '...' : ''}
`).join('\n') : 'No open findings.'}

## How to Resume

1. **Verify Connection**:
   \`\`\`
   goodflows_project_info()
   \`\`\`

2. **Resume Session**:
   \`\`\`
   ${sessionData ? `goodflows_session_resume({ sessionId: "${sessionData.id}" })` : 'goodflows_session_start({ trigger: "handoff-resume" })'}
   \`\`\`

3. **Check Progress**:
   \`\`\`
   goodflows_get_tracking_summary()
   \`\`\`

4. **View Open Work**:
   \`\`\`
   goodflows_context_query({ status: "open" })
   \`\`\`
`;
    } else { // technical
      prompt = `# GoodFlows Context Handoff

\`\`\`json
${JSON.stringify({
  project: projectContext.project,
  github: projectContext.github,
  session: sessionData,
  currentWork,
  tracking: trackingSummary,
  openFindings: recentFindings.length,
}, null, 2)}
\`\`\`

## Resume Commands
\`\`\`javascript
// 1. Verify
await goodflows_project_info()

// 2. Resume session
${sessionData
  ? `await goodflows_session_resume({ sessionId: "${sessionData.id}" })`
  : 'await goodflows_session_start({ trigger: "handoff" })'}

// 3. Check state
await goodflows_get_tracking_summary()
await goodflows_context_query({ status: "open", limit: 10 })
\`\`\`
`;
    }

    return mcpResponse({ prompt });
  },

  async goodflows_sync_linear(args, services) {
    const { contextStore } = services;

    try {
      let issues = [];

      if (args.issues && Array.isArray(args.issues) && args.issues.length > 0) {
        issues = args.issues;
      } else {
        const linearApiKey = process.env.LINEAR_API_KEY;
        if (!linearApiKey) {
          return mcpError('No issues provided and LINEAR_API_KEY not set', 'API_KEY_MISSING');
        }

        if (!args.team) {
          return mcpError('team parameter required for direct API call', 'MISSING_TEAM');
        }

        const query = `
          query($teamKey: String!, $first: Int) {
            team(key: $teamKey) {
              issues(first: $first, orderBy: createdAt) {
                nodes {
                  id
                  identifier
                  title
                  description
                  state { name }
                  labels { nodes { name } }
                  createdAt
                  updatedAt
                }
              }
            }
          }
        `;

        const response = await fetch('https://api.linear.app/graphql', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': linearApiKey,
          },
          body: JSON.stringify({
            query,
            variables: {
              teamKey: args.team,
              first: args.limit || 50,
            },
          }),
        });

        const data = await response.json();

        if (data.errors) {
          return mcpError(JSON.stringify(data.errors), 'LINEAR_API_ERROR');
        }

        issues = data.data?.team?.issues?.nodes || [];
      }

      let synced = 0;
      let skipped = 0;

      for (const issue of issues) {
        const issueId = issue.identifier || issue.id;
        const issueTitle = issue.title;
        const issueState = issue.state?.name || issue.state;
        const issueCreatedAt = issue.createdAt;

        let labelNames = [];
        if (issue.labels) {
          if (Array.isArray(issue.labels)) {
            labelNames = issue.labels.map(l => (typeof l === 'string' ? l : l.name)?.toLowerCase()).filter(Boolean);
          } else if (issue.labels.nodes) {
            labelNames = issue.labels.nodes.map(l => l.name?.toLowerCase()).filter(Boolean);
          }
        }

        // Apply filters
        if (args.status) {
          const stateMap = {
            open: ['Backlog', 'Todo', 'In Progress', 'backlog', 'todo', 'in progress', 'unstarted', 'started'],
            in_progress: ['In Progress', 'in progress', 'started'],
            done: ['Done', 'Canceled', 'done', 'canceled', 'completed'],
          };
          const validStates = stateMap[args.status] || [];
          const normalizedState = (issueState || '').toLowerCase();
          if (!validStates.some(s => s.toLowerCase() === normalizedState)) continue;
        }

        if (args.labels && args.labels.length > 0) {
          const hasLabel = args.labels.some(l => labelNames.includes(l.toLowerCase()));
          if (!hasLabel) continue;
        }

        if (args.since && issueCreatedAt < args.since) continue;

        let type = 'potential_issue';
        if (labelNames.includes('security') || labelNames.includes('critical')) type = 'critical_security';
        else if (labelNames.includes('performance')) type = 'performance';
        else if (labelNames.includes('improvement') || labelNames.includes('refactor')) type = 'refactor_suggestion';
        else if (labelNames.includes('docs') || labelNames.includes('documentation')) type = 'documentation';

        const result = contextStore.addFinding({
          file: 'linear-sync',
          type,
          description: `[${issueId}] ${issueTitle}`,
          issueId: issueId,
          status: ['Done', 'done', 'completed', 'Canceled', 'canceled'].includes(issueState) ? 'fixed' : 'open',
          source: 'linear',
          linearId: issue.id,
          createdAt: issueCreatedAt,
        });

        if (result.added) synced++;
        else skipped++;
      }

      return mcpResponse({
        success: true,
        team: args.team || 'from-mcp',
        synced,
        skipped,
        total: issues.length,
        source: args.issues ? 'pre-fetched' : 'api',
      });
    } catch (error) {
      return mcpError(error.message, 'SYNC_ERROR');
    }
  },

  async goodflows_resolve_linear_team(args, services) {
    try {
      const teamInput = args.team;
      const teams = args.teams;

      if (!teams || !Array.isArray(teams) || teams.length === 0) {
        return mcpError('No teams provided. First call linear_list_teams() then pass the result.', 'NO_TEAMS');
      }

      const inputLower = teamInput.toLowerCase();
      const resolved = teams.find(t =>
        t.key === teamInput ||
        t.key?.toLowerCase() === inputLower ||
        t.name === teamInput ||
        t.name?.toLowerCase() === inputLower ||
        t.id === teamInput,
      );

      if (!resolved) {
        const availableTeams = teams.map(t => `${t.name} (key: ${t.key})`).join(', ');
        return mcpError(`Team "${teamInput}" not found. Available: ${availableTeams}`, 'TEAM_NOT_FOUND');
      }

      return mcpResponse({
        resolved: true,
        id: resolved.id,
        name: resolved.name,
        key: resolved.key,
        input: teamInput,
        message: `Resolved "${teamInput}" to team "${resolved.name}" (${resolved.key})`,
      });
    } catch (error) {
      return mcpError(error.message, 'RESOLVE_ERROR');
    }
  },

  async goodflows_auto_index(args, services) {
    const { autoIndexConfig, goodflowsBasePath } = services;

    if (args.enabled !== undefined) {
      autoIndexConfig.enabled = args.enabled;
    }
    if (args.sources) {
      autoIndexConfig.sources = args.sources;
    }
    if (args.sessionId) {
      autoIndexConfig.sessionId = args.sessionId;
    }

    // Save config to disk
    const configPath = join(goodflowsBasePath, 'auto-index.json');
    try {
      const { writeFileSync, mkdirSync } = await import('fs');
      const { dirname } = await import('path');
      mkdirSync(dirname(configPath), { recursive: true });
      writeFileSync(configPath, JSON.stringify(autoIndexConfig, null, 2));
    } catch {
      // Ignore write errors
    }

    return mcpResponse({
      success: true,
      config: autoIndexConfig,
    });
  },

  async goodflows_preflight_check(args, services) {
    const { activeSessions, findLinearMatches, getMatchRecommendation } = services;

    try {
      const { action, findings, sessionId, linearIssues, options = {} } = args;
      const {
        similarityThreshold = 0.5,
        includeInProgress = true,
        includeDone = false,
        forceRefresh = false,
      } = options;

      if (!findings || !Array.isArray(findings) || findings.length === 0) {
        return mcpResponse({
          status: 'clear',
          conflicts: [],
          clear: [],
          summary: { total: 0, conflicts: 0, clear: 0 },
          requiresConfirmation: false,
          message: 'No findings to check',
        });
      }

      const session = activeSessions.get(sessionId);
      const CACHE_TTL = 5 * 60 * 1000;

      let issues = null;
      let cacheInfo = { hit: false, age: null };

      if (session && !forceRefresh) {
        const cached = session.get('preflight.linearIssuesCache');
        const cachedAt = session.get('preflight.cacheTimestamp');
        if (cached && cachedAt && (Date.now() - cachedAt) < CACHE_TTL) {
          issues = cached;
          cacheInfo = { hit: true, age: Math.round((Date.now() - cachedAt) / 1000) };
        }
      }

      if (!issues) {
        if (linearIssues && Array.isArray(linearIssues) && linearIssues.length > 0) {
          issues = linearIssues;
          if (session) {
            session.set('preflight.linearIssuesCache', issues);
            session.set('preflight.cacheTimestamp', Date.now());
          }
          cacheInfo = { hit: false, source: 'provided' };
        } else {
          return mcpResponse({
            status: 'clear',
            conflicts: [],
            clear: findings,
            summary: { total: findings.length, conflicts: 0, clear: findings.length },
            requiresConfirmation: false,
            warning: 'No Linear issues provided for comparison.',
            cache: cacheInfo,
          });
        }
      }

      const includeStatus = ['Backlog', 'Todo', 'backlog', 'todo', 'unstarted'];
      if (includeInProgress) {
        includeStatus.push('In Progress', 'in progress', 'started');
      }
      if (includeDone) {
        includeStatus.push('Done', 'done', 'completed', 'Canceled', 'canceled');
      }

      const conflicts = [];
      const clear = [];

      for (const finding of findings) {
        const matches = findLinearMatches(finding, issues, {
          threshold: similarityThreshold,
          includeStatus,
        });

        if (matches.length > 0) {
          const enrichedMatches = matches.map(m => ({
            ...m,
            recommendation: getMatchRecommendation(action, m),
          }));

          conflicts.push({
            finding,
            matches: enrichedMatches,
            bestMatch: enrichedMatches[0],
            recommendation: enrichedMatches[0].recommendation,
          });
        } else {
          clear.push(finding);
        }
      }

      if (session) {
        session.set('preflight.lastCheck', {
          action,
          timestamp: Date.now(),
          conflictsFound: conflicts.length,
          clearCount: clear.length,
        });
      }

      return mcpResponse({
        status: conflicts.length > 0 ? 'conflicts_found' : 'clear',
        conflicts,
        clear,
        summary: {
          total: findings.length,
          conflicts: conflicts.length,
          clear: clear.length,
        },
        requiresConfirmation: conflicts.length > 0,
        cache: { ...cacheInfo, issueCount: issues.length },
        promptOptions: conflicts.length > 0 ? [
          { id: 'skip', label: 'Skip conflicts', description: `Process only ${clear.length} clear findings` },
          { id: 'link', label: 'Link to existing', description: 'Add comments to existing issues instead' },
          { id: 'force', label: 'Force create', description: 'Create anyway (marked as potential duplicate)' },
          { id: 'abort', label: 'Abort', description: 'Stop workflow entirely' },
        ] : null,
      });
    } catch (error) {
      return mcpError(error.message, 'PREFLIGHT_ERROR');
    }
  },

  async goodflows_context_file_read(args, services) {
    const { contextFileManager } = services;

    try {
      const result = await contextFileManager.read(args.file);
      return mcpResponse(result);
    } catch (error) {
      return mcpError(error.message, 'READ_ERROR');
    }
  },

  async goodflows_context_file_write(args, services) {
    const { contextFileManager } = services;

    try {
      const result = await contextFileManager.write(args.file, args.content, {
        allowOversize: args.allowOversize,
      });
      return mcpResponse(result);
    } catch (error) {
      return mcpError(error.message, 'WRITE_ERROR');
    }
  },

  async goodflows_context_file_status(args, services) {
    const { contextFileManager } = services;

    try {
      const result = await contextFileManager.status();
      return mcpResponse(result);
    } catch (error) {
      return mcpError(error.message, 'STATUS_ERROR');
    }
  },

  async goodflows_context_file_init(args, services) {
    const { contextFileManager } = services;

    try {
      const result = await contextFileManager.init({ force: args.force });
      return mcpResponse(result);
    } catch (error) {
      return mcpError(error.message, 'INIT_ERROR');
    }
  },

  async goodflows_state_update(args, services) {
    const { contextFileManager } = services;

    try {
      const result = await contextFileManager.updateState(args);
      return mcpResponse(result);
    } catch (error) {
      return mcpError(error.message, 'UPDATE_ERROR');
    }
  },

  async goodflows_summary_add(args, services) {
    const { contextFileManager } = services;

    try {
      const result = await contextFileManager.addSummary({
        task: args.task,
        status: args.status,
        changes: args.changes,
        verification: args.verification,
        notes: args.notes,
      });
      return mcpResponse(result);
    } catch (error) {
      return mcpError(error.message, 'SUMMARY_ERROR');
    }
  },

  async goodflows_summary_create(args, services) {
    const { phaseManager } = services;

    try {
      const result = await phaseManager.createSummary({
        phase: args.phase,
        planNumber: args.planNumber,
        taskCommits: args.taskCommits,
        accomplishments: args.accomplishments,
        deviations: args.deviations,
        metrics: args.metrics,
      });
      return mcpResponse(result);
    } catch (error) {
      return mcpError(error.message, 'SUMMARY_CREATE_ERROR');
    }
  },

  async goodflows_autoload_context(args, services) {
    const { contextFileManager } = services;

    try {
      const result = await contextFileManager.getAutoLoadContext({
        agentType: args.agentType,
        isPlanning: args.isPlanning,
        hasTask: args.hasTask,
      });
      return mcpResponse({
        tokens: result.tokens,
        filesLoaded: result.filesLoaded,
        content: result.content,
      });
    } catch (error) {
      return mcpError(error.message, 'AUTOLOAD_ERROR');
    }
  },
};

export default { tools, handlers };
