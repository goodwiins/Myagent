#!/usr/bin/env node
/**
 * GoodFlows MCP Server
 *
 * Exposes GoodFlows features to Claude agents via Model Context Protocol.
 *
 * Tools provided:
 * - goodflows_context_query: Query findings from context store
 * - goodflows_context_add: Add finding to context store
 * - goodflows_context_export: Export findings to markdown
 * - goodflows_session_start: Start a new session
 * - goodflows_session_resume: Resume existing session
 * - goodflows_session_checkpoint: Create checkpoint
 * - goodflows_session_rollback: Rollback to checkpoint
 * - goodflows_pattern_recommend: Get fix pattern recommendations
 * - goodflows_pattern_record: Record fix pattern result
 * - goodflows_queue_create: Create priority queue from findings
 * - goodflows_queue_next: Get next highest priority item
 * - goodflows_stats: Get store statistics
 *
 * Usage:
 *   npx goodflows-mcp-server
 *
 * Or add to Claude settings:
 *   "mcpServers": {
 *     "goodflows": {
 *       "command": "npx",
 *       "args": ["goodflows-mcp-server"]
 *     }
 *   }
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

import { join } from 'path';
import { existsSync, readFileSync } from 'fs';

import { ContextStore } from '../lib/context-store.js';
import { SessionContextManager } from '../lib/session-context.js';
import { PatternTracker } from '../lib/pattern-tracker.js';
import { PriorityQueue, PRIORITY, TYPE_TO_PRIORITY } from '../lib/priority-queue.js';

// Initialize GoodFlows components
const contextStore = new ContextStore({ basePath: '.goodflows/context' });
const patternTracker = new PatternTracker({ basePath: '.goodflows/context/patterns' });

// Active sessions and queues (in-memory for current process)
const activeSessions = new Map();
const activeQueues = new Map();

// Auto-index configuration (loaded from disk if exists)
let autoIndexConfig = {
  enabled: false,
  sources: ['linear', 'coderabbit', 'fixes'],
  sessionId: null,
};

// Load existing auto-index config
const autoIndexConfigPath = join(process.cwd(), '.goodflows', 'auto-index.json');
if (existsSync(autoIndexConfigPath)) {
  try {
    autoIndexConfig = JSON.parse(readFileSync(autoIndexConfigPath, 'utf-8'));
  } catch (e) {
    // Use defaults
  }
}

// ─────────────────────────────────────────────────────────────
// Project & GitHub Detection
// ─────────────────────────────────────────────────────────────

/**
 * Detect project information from package.json and git
 */
function detectProjectInfo() {
  const cwd = process.cwd();
  const info = {
    name: null,
    version: null,
    description: null,
    directory: cwd,
    directoryName: cwd.split('/').pop(),
  };

  // Try package.json
  const packageJsonPath = join(cwd, 'package.json');
  if (existsSync(packageJsonPath)) {
    try {
      const pkg = JSON.parse(readFileSync(packageJsonPath, 'utf-8'));
      info.name = pkg.name || null;
      info.version = pkg.version || null;
      info.description = pkg.description || null;
      info.author = pkg.author || null;
      info.license = pkg.license || null;
      info.repository = pkg.repository || null;
    } catch (e) {
      // Ignore parse errors
    }
  }

  // Fallback to directory name if no package.json name
  if (!info.name) {
    info.name = info.directoryName;
  }

  return info;
}

/**
 * Detect GitHub repository info from git remote
 */
function detectGitHubInfo() {
  const cwd = process.cwd();
  const info = {
    isGitRepo: false,
    remote: null,
    owner: null,
    repo: null,
    url: null,
    branch: null,
    defaultBranch: null,
  };

  // Check if .git exists
  if (!existsSync(join(cwd, '.git'))) {
    return info;
  }

  info.isGitRepo = true;

  // Try to read git config
  const gitConfigPath = join(cwd, '.git', 'config');
  if (existsSync(gitConfigPath)) {
    try {
      const gitConfig = readFileSync(gitConfigPath, 'utf-8');

      // Parse remote origin URL
      const remoteMatch = gitConfig.match(/\[remote "origin"\][^\[]*url\s*=\s*(.+)/m);
      if (remoteMatch) {
        const remoteUrl = remoteMatch[1].trim();
        info.remote = remoteUrl;

        // Parse GitHub URL (supports https and ssh formats)
        // https://github.com/owner/repo.git
        // git@github.com:owner/repo.git
        const httpsMatch = remoteUrl.match(/github\.com\/([^\/]+)\/([^\/\.]+)/);
        const sshMatch = remoteUrl.match(/github\.com:([^\/]+)\/([^\/\.]+)/);

        if (httpsMatch) {
          info.owner = httpsMatch[1];
          info.repo = httpsMatch[2].replace(/\.git$/, '');
          info.url = `https://github.com/${info.owner}/${info.repo}`;
        } else if (sshMatch) {
          info.owner = sshMatch[1];
          info.repo = sshMatch[2].replace(/\.git$/, '');
          info.url = `https://github.com/${info.owner}/${info.repo}`;
        }
      }
    } catch (e) {
      // Ignore read errors
    }
  }

  // Try to read current branch from HEAD
  const headPath = join(cwd, '.git', 'HEAD');
  if (existsSync(headPath)) {
    try {
      const head = readFileSync(headPath, 'utf-8').trim();
      const branchMatch = head.match(/ref: refs\/heads\/(.+)/);
      if (branchMatch) {
        info.branch = branchMatch[1];
      }
    } catch (e) {
      // Ignore read errors
    }
  }

  // Try to detect default branch
  const defaultBranches = ['main', 'master', 'develop'];
  for (const branch of defaultBranches) {
    if (existsSync(join(cwd, '.git', 'refs', 'heads', branch))) {
      info.defaultBranch = branch;
      break;
    }
  }

  return info;
}

// Cache project info (computed once at startup)
let projectInfo = null;
let gitHubInfo = null;

function getProjectInfo() {
  if (!projectInfo) {
    projectInfo = detectProjectInfo();
  }
  return projectInfo;
}

function getGitHubInfo() {
  if (!gitHubInfo) {
    gitHubInfo = detectGitHubInfo();
  }
  return gitHubInfo;
}

/**
 * Get combined project context for sessions
 */
function getProjectContext() {
  return {
    project: getProjectInfo(),
    github: getGitHubInfo(),
    cwd: process.cwd(),
    timestamp: new Date().toISOString(),
  };
}

// Create MCP server
const server = new Server(
  {
    name: 'goodflows',
    version: '1.1.5',
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// Define all GoodFlows tools
const TOOLS = [
  // ========== Context Store Tools ==========
  {
    name: 'goodflows_context_query',
    description: `Query findings from GoodFlows context store. Use this to check for existing findings before creating issues.

Examples:
- Query all open bugs: { "type": "bug", "status": "open" }
- Query by file: { "file": "src/api/auth.js" }
- Query security issues: { "type": "critical_security" }`,
    inputSchema: {
      type: 'object',
      properties: {
        type: {
          type: 'string',
          description: 'Finding type: critical_security, potential_issue, refactor_suggestion, performance, documentation',
        },
        file: {
          type: 'string',
          description: 'File path to filter by (substring match)',
        },
        status: {
          type: 'string',
          description: 'Status: open, in_progress, fixed, wont_fix',
        },
        limit: {
          type: 'number',
          description: 'Max results (default: 20)',
        },
      },
    },
  },
  {
    name: 'goodflows_context_add',
    description: `Add a finding to the context store. Returns hash for deduplication and linking.

The store automatically:
- Deduplicates by content hash
- Indexes by file and type
- Checks similarity to existing findings`,
    inputSchema: {
      type: 'object',
      properties: {
        file: { type: 'string', description: 'File path' },
        lines: { type: 'string', description: 'Line range (e.g., "45-52")' },
        type: { type: 'string', description: 'Finding type' },
        description: { type: 'string', description: 'Finding description' },
        severity: { type: 'string', description: 'Severity level' },
        proposedFix: { type: 'string', description: 'Suggested fix' },
      },
      required: ['file', 'type', 'description'],
    },
  },
  {
    name: 'goodflows_context_update',
    description: 'Update a finding status (e.g., mark as fixed, link to issue)',
    inputSchema: {
      type: 'object',
      properties: {
        hash: { type: 'string', description: 'Finding hash' },
        status: { type: 'string', description: 'New status' },
        issueId: { type: 'string', description: 'Linear issue ID (e.g., GOO-31)' },
      },
      required: ['hash'],
    },
  },
  {
    name: 'goodflows_context_export',
    description: 'Export findings to markdown format for reporting',
    inputSchema: {
      type: 'object',
      properties: {
        type: { type: 'string', description: 'Filter by type' },
        status: { type: 'string', description: 'Filter by status' },
        outputPath: { type: 'string', description: 'Output file (default: .goodflows/export.md)' },
      },
    },
  },
  {
    name: 'goodflows_context_check_duplicate',
    description: 'Check if a finding already exists (by hash or similarity)',
    inputSchema: {
      type: 'object',
      properties: {
        file: { type: 'string' },
        type: { type: 'string' },
        description: { type: 'string' },
        similarityThreshold: { type: 'number', description: 'Similarity threshold 0-1 (default: 0.85)' },
      },
      required: ['description'],
    },
  },

  // ========== Session Tools ==========
  {
    name: 'goodflows_session_start',
    description: `Start a new workflow session. Sessions enable context sharing between agents.

Returns sessionId that should be passed to other agents for context propagation.`,
    inputSchema: {
      type: 'object',
      properties: {
        trigger: { type: 'string', description: 'What triggered this session (e.g., code-review, fix-issue)' },
        metadata: { type: 'object', description: 'Additional metadata (branch, PR number, etc.)' },
      },
    },
  },
  {
    name: 'goodflows_session_resume',
    description: 'Resume an existing session to access shared context',
    inputSchema: {
      type: 'object',
      properties: {
        sessionId: { type: 'string', description: 'Session ID to resume' },
      },
      required: ['sessionId'],
    },
  },
  {
    name: 'goodflows_session_get_context',
    description: 'Get value from session context (dot notation supported)',
    inputSchema: {
      type: 'object',
      properties: {
        sessionId: { type: 'string' },
        path: { type: 'string', description: 'Context path (e.g., findings.all, issues.created)' },
      },
      required: ['sessionId', 'path'],
    },
  },
  {
    name: 'goodflows_session_set_context',
    description: 'Set value in session context for other agents to read',
    inputSchema: {
      type: 'object',
      properties: {
        sessionId: { type: 'string' },
        path: { type: 'string', description: 'Context path' },
        value: { description: 'Value to store (any JSON type)' },
      },
      required: ['sessionId', 'path', 'value'],
    },
  },
  {
    name: 'goodflows_session_checkpoint',
    description: 'Create a checkpoint for potential rollback',
    inputSchema: {
      type: 'object',
      properties: {
        sessionId: { type: 'string' },
        name: { type: 'string', description: 'Checkpoint name (e.g., before_fixes)' },
      },
      required: ['sessionId', 'name'],
    },
  },
  {
    name: 'goodflows_session_rollback',
    description: 'Rollback session to a checkpoint',
    inputSchema: {
      type: 'object',
      properties: {
        sessionId: { type: 'string' },
        checkpointId: { type: 'string' },
      },
      required: ['sessionId', 'checkpointId'],
    },
  },
  {
    name: 'goodflows_session_end',
    description: 'End session and persist final state',
    inputSchema: {
      type: 'object',
      properties: {
        sessionId: { type: 'string' },
        status: { type: 'string', description: 'completed, failed, partial' },
        summary: { type: 'object', description: 'Final summary data' },
      },
      required: ['sessionId'],
    },
  },

  // ========== Pattern Tracker Tools ==========
  {
    name: 'goodflows_pattern_recommend',
    description: `Get recommended fix patterns based on finding type and description.

Returns patterns sorted by confidence score. Only apply patterns with confidence > 0.7.`,
    inputSchema: {
      type: 'object',
      properties: {
        type: { type: 'string', description: 'Finding type' },
        description: { type: 'string', description: 'Finding description for similarity matching' },
        minConfidence: { type: 'number', description: 'Minimum confidence (default: 0.5)' },
      },
      required: ['type'],
    },
  },
  {
    name: 'goodflows_pattern_record_success',
    description: 'Record successful fix to improve pattern confidence',
    inputSchema: {
      type: 'object',
      properties: {
        patternId: { type: 'string' },
        file: { type: 'string' },
        issueId: { type: 'string' },
        context: { type: 'string', description: 'Additional context' },
      },
      required: ['patternId'],
    },
  },
  {
    name: 'goodflows_pattern_record_failure',
    description: 'Record failed fix to decrease pattern confidence',
    inputSchema: {
      type: 'object',
      properties: {
        patternId: { type: 'string' },
        file: { type: 'string' },
        issueId: { type: 'string' },
        reason: { type: 'string', description: 'Why the fix failed' },
      },
      required: ['patternId', 'reason'],
    },
  },
  {
    name: 'goodflows_pattern_add',
    description: 'Add a new reusable fix pattern',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Pattern ID (e.g., env-var-secret)' },
        type: { type: 'string', description: 'Finding type this pattern fixes' },
        description: { type: 'string' },
        template: { type: 'string', description: 'Code template for the fix' },
        keywords: { type: 'array', items: { type: 'string' }, description: 'Keywords for matching' },
      },
      required: ['id', 'type', 'description'],
    },
  },

  // ========== Priority Queue Tools ==========
  {
    name: 'goodflows_queue_create',
    description: `Create a priority queue from findings. Items are auto-sorted by priority.

Priority order: P1 (critical_security) → P2 (potential_issue) → P3 (refactor/perf) → P4 (docs)`,
    inputSchema: {
      type: 'object',
      properties: {
        queueId: { type: 'string', description: 'Queue identifier' },
        findings: { type: 'array', description: 'Array of findings to queue' },
        priorityThreshold: { type: 'number', description: 'Only include items at or above this priority (1-4)' },
      },
      required: ['queueId', 'findings'],
    },
  },
  {
    name: 'goodflows_queue_next',
    description: 'Get next highest priority item from queue',
    inputSchema: {
      type: 'object',
      properties: {
        queueId: { type: 'string' },
      },
      required: ['queueId'],
    },
  },
  {
    name: 'goodflows_queue_complete',
    description: 'Mark current item as completed',
    inputSchema: {
      type: 'object',
      properties: {
        queueId: { type: 'string' },
        result: { type: 'object', description: 'Completion result data' },
      },
      required: ['queueId'],
    },
  },
  {
    name: 'goodflows_queue_fail',
    description: 'Mark current item as failed (will be retried up to 3x)',
    inputSchema: {
      type: 'object',
      properties: {
        queueId: { type: 'string' },
        error: { type: 'string', description: 'Error message' },
      },
      required: ['queueId'],
    },
  },
  {
    name: 'goodflows_queue_stats',
    description: 'Get queue statistics',
    inputSchema: {
      type: 'object',
      properties: {
        queueId: { type: 'string' },
      },
      required: ['queueId'],
    },
  },

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
          description: 'Sources to auto-index: linear, coderabbit, fixes'
        },
        sessionId: { type: 'string', description: 'Session to attach auto-indexed findings to' },
      },
    },
  },

  // ========== Easy Tracking Tools ==========
  {
    name: 'goodflows_track_file',
    description: `Track a file operation in the current session.

Automatically updates stats and context. Use within a session to track files created/modified/deleted.

Example: { "sessionId": "...", "path": "src/auth.ts", "action": "created" }`,
    inputSchema: {
      type: 'object',
      properties: {
        sessionId: { type: 'string', description: 'Session ID' },
        path: { type: 'string', description: 'File path' },
        action: { type: 'string', enum: ['created', 'modified', 'deleted'], description: 'Action type' },
        meta: { type: 'object', description: 'Optional metadata' },
      },
      required: ['sessionId', 'path'],
    },
  },
  {
    name: 'goodflows_track_files',
    description: 'Track multiple file operations at once',
    inputSchema: {
      type: 'object',
      properties: {
        sessionId: { type: 'string', description: 'Session ID' },
        paths: { type: 'array', items: { type: 'string' }, description: 'File paths' },
        action: { type: 'string', enum: ['created', 'modified', 'deleted'], description: 'Action type' },
        meta: { type: 'object', description: 'Optional metadata' },
      },
      required: ['sessionId', 'paths'],
    },
  },
  {
    name: 'goodflows_track_issue',
    description: `Track an issue operation in the current session.

Example: { "sessionId": "...", "issueId": "GOO-53", "action": "fixed" }`,
    inputSchema: {
      type: 'object',
      properties: {
        sessionId: { type: 'string', description: 'Session ID' },
        issueId: { type: 'string', description: 'Issue ID (e.g., GOO-53)' },
        action: { type: 'string', enum: ['created', 'fixed', 'skipped', 'failed'], description: 'Action type' },
        meta: { type: 'object', description: 'Optional metadata (title, reason, error)' },
      },
      required: ['sessionId', 'issueId'],
    },
  },
  {
    name: 'goodflows_track_finding',
    description: `Track a finding in the current session.

Example: { "sessionId": "...", "finding": { "type": "security", "file": "auth.ts", "description": "..." } }`,
    inputSchema: {
      type: 'object',
      properties: {
        sessionId: { type: 'string', description: 'Session ID' },
        finding: {
          type: 'object',
          properties: {
            type: { type: 'string', description: 'Finding type' },
            file: { type: 'string', description: 'File path' },
            description: { type: 'string', description: 'Description' },
          },
          required: ['type', 'description'],
        },
      },
      required: ['sessionId', 'finding'],
    },
  },
  {
    name: 'goodflows_start_work',
    description: `Start a unit of work within a session.

Work units group related tracking together. Files and issues tracked after this call
will be linked to this work unit.

Example: { "sessionId": "...", "type": "fix-issue", "meta": { "issueId": "GOO-53", "title": "..." } }`,
    inputSchema: {
      type: 'object',
      properties: {
        sessionId: { type: 'string', description: 'Session ID' },
        type: { type: 'string', description: 'Work type (fix-issue, implement-feature, code-review)' },
        meta: { type: 'object', description: 'Work metadata (issueId, title, description, etc.)' },
      },
      required: ['sessionId', 'type'],
    },
  },
  {
    name: 'goodflows_complete_work',
    description: `Complete the current unit of work.

Calculates totals from tracked items and returns a summary.

Example: { "sessionId": "...", "result": { "success": true, "endpoints": 5 } }`,
    inputSchema: {
      type: 'object',
      properties: {
        sessionId: { type: 'string', description: 'Session ID' },
        result: { type: 'object', description: 'Result data to include in summary' },
      },
      required: ['sessionId'],
    },
  },
  {
    name: 'goodflows_get_tracking_summary',
    description: 'Get a summary of all tracked items in the session',
    inputSchema: {
      type: 'object',
      properties: {
        sessionId: { type: 'string', description: 'Session ID' },
      },
      required: ['sessionId'],
    },
  },
];

// Handle list tools request
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: TOOLS,
}));

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      // ========== Context Store Handlers ==========
      case 'goodflows_context_query': {
        const results = contextStore.query({
          type: args.type,
          file: args.file,
          status: args.status,
          limit: args.limit || 20,
        });
        return {
          content: [{ type: 'text', text: JSON.stringify({ count: results.length, findings: results }, null, 2) }],
        };
      }

      case 'goodflows_context_add': {
        const result = contextStore.addFinding({
          file: args.file,
          lines: args.lines,
          type: args.type,
          description: args.description,
          severity: args.severity,
          proposedFix: args.proposedFix,
          status: 'open',
        });
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        };
      }

      case 'goodflows_context_update': {
        const result = contextStore.updateFinding(args.hash, {
          status: args.status,
          issueId: args.issueId,
        });
        return {
          content: [{ type: 'text', text: JSON.stringify({ success: true, updated: result }, null, 2) }],
        };
      }

      case 'goodflows_context_export': {
        const markdown = contextStore.exportToMarkdown({
          type: args.type,
          status: args.status,
        });
        const outputPath = args.outputPath || '.goodflows/export.md';
        const { writeFileSync } = await import('fs');
        writeFileSync(outputPath, markdown);
        return {
          content: [{ type: 'text', text: JSON.stringify({ success: true, path: outputPath, preview: markdown.slice(0, 500) + '...' }, null, 2) }],
        };
      }

      case 'goodflows_context_check_duplicate': {
        const existing = contextStore.findSimilar(args.description, {
          threshold: args.similarityThreshold || 0.85,
          file: args.file,
          type: args.type,
        });
        return {
          content: [{ type: 'text', text: JSON.stringify({
            isDuplicate: existing.length > 0,
            similarFindings: existing,
          }, null, 2) }],
        };
      }

      // ========== Session Handlers ==========
      case 'goodflows_session_start': {
        const session = new SessionContextManager();

        // Get project context to auto-populate metadata
        const projectContext = getProjectContext();

        const sessionId = session.start({
          trigger: args.trigger || 'manual',
          // Auto-populate with project info
          project: projectContext.project.name,
          projectVersion: projectContext.project.version,
          github: projectContext.github.url,
          githubOwner: projectContext.github.owner,
          githubRepo: projectContext.github.repo,
          branch: projectContext.github.branch || args.metadata?.branch,
          // User-provided metadata takes precedence
          ...args.metadata,
        });

        activeSessions.set(sessionId, session);

        // Store project context in session for reference
        session.set('project', projectContext.project);
        session.set('github', projectContext.github);

        return {
          content: [{ type: 'text', text: JSON.stringify({
            sessionId,
            status: 'started',
            project: projectContext.project.name,
            github: projectContext.github.url,
            branch: projectContext.github.branch,
          }, null, 2) }],
        };
      }

      case 'goodflows_session_resume': {
        let session = activeSessions.get(args.sessionId);
        if (!session) {
          session = SessionContextManager.resume(args.sessionId);
          if (session) {
            activeSessions.set(args.sessionId, session);
          }
        }
        if (!session) {
          return {
            content: [{ type: 'text', text: JSON.stringify({ error: 'Session not found', sessionId: args.sessionId }, null, 2) }],
            isError: true,
          };
        }
        return {
          content: [{ type: 'text', text: JSON.stringify({ sessionId: args.sessionId, status: 'resumed', context: session.getAll() }, null, 2) }],
        };
      }

      case 'goodflows_session_get_context': {
        const session = activeSessions.get(args.sessionId);
        if (!session) {
          return {
            content: [{ type: 'text', text: JSON.stringify({ error: 'Session not found' }, null, 2) }],
            isError: true,
          };
        }
        const value = session.get(args.path);
        return {
          content: [{ type: 'text', text: JSON.stringify({ path: args.path, value }, null, 2) }],
        };
      }

      case 'goodflows_session_set_context': {
        const session = activeSessions.get(args.sessionId);
        if (!session) {
          return {
            content: [{ type: 'text', text: JSON.stringify({ error: 'Session not found' }, null, 2) }],
            isError: true,
          };
        }
        session.set(args.path, args.value);
        return {
          content: [{ type: 'text', text: JSON.stringify({ success: true, path: args.path }, null, 2) }],
        };
      }

      case 'goodflows_session_checkpoint': {
        const session = activeSessions.get(args.sessionId);
        if (!session) {
          return {
            content: [{ type: 'text', text: JSON.stringify({ error: 'Session not found' }, null, 2) }],
            isError: true,
          };
        }
        const checkpointId = session.checkpoint(args.name);
        return {
          content: [{ type: 'text', text: JSON.stringify({ checkpointId, name: args.name }, null, 2) }],
        };
      }

      case 'goodflows_session_rollback': {
        const session = activeSessions.get(args.sessionId);
        if (!session) {
          return {
            content: [{ type: 'text', text: JSON.stringify({ error: 'Session not found' }, null, 2) }],
            isError: true,
          };
        }
        session.rollback(args.checkpointId);
        return {
          content: [{ type: 'text', text: JSON.stringify({ success: true, rolledBackTo: args.checkpointId }, null, 2) }],
        };
      }

      case 'goodflows_session_end': {
        const session = activeSessions.get(args.sessionId);
        if (!session) {
          return {
            content: [{ type: 'text', text: JSON.stringify({ error: 'Session not found' }, null, 2) }],
            isError: true,
          };
        }
        session.complete(args.summary || {});
        const finalSummary = session.session?.summary || {};
        activeSessions.delete(args.sessionId);
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: true,
              status: args.status || 'completed',
              summary: finalSummary,
              hasConflicts: finalSummary._hasConflicts || false,
              derived: finalSummary._derived || {},
            }, null, 2),
          }],
        };
      }

      // ========== Pattern Tracker Handlers ==========
      case 'goodflows_pattern_recommend': {
        const patterns = patternTracker.recommend(args.type, args.description || '', {
          minConfidence: args.minConfidence || 0.5,
        });
        return {
          content: [{ type: 'text', text: JSON.stringify({ patterns }, null, 2) }],
        };
      }

      case 'goodflows_pattern_record_success': {
        patternTracker.recordSuccess(args.patternId, {
          file: args.file,
          issueId: args.issueId,
          context: args.context,
        });
        return {
          content: [{ type: 'text', text: JSON.stringify({ success: true, patternId: args.patternId }, null, 2) }],
        };
      }

      case 'goodflows_pattern_record_failure': {
        patternTracker.recordFailure(args.patternId, {
          file: args.file,
          issueId: args.issueId,
          reason: args.reason,
        });
        return {
          content: [{ type: 'text', text: JSON.stringify({ success: true, patternId: args.patternId }, null, 2) }],
        };
      }

      case 'goodflows_pattern_add': {
        patternTracker.addPattern({
          id: args.id,
          type: args.type,
          description: args.description,
          template: args.template,
          applicability: {
            keywords: args.keywords || [],
          },
        });
        return {
          content: [{ type: 'text', text: JSON.stringify({ success: true, patternId: args.id }, null, 2) }],
        };
      }

      // ========== Priority Queue Handlers ==========
      case 'goodflows_queue_create': {
        const queue = new PriorityQueue({
          priorityThreshold: args.priorityThreshold,
        });
        for (const finding of args.findings) {
          queue.enqueue(finding);
        }
        activeQueues.set(args.queueId, queue);
        return {
          content: [{ type: 'text', text: JSON.stringify({
            queueId: args.queueId,
            stats: queue.getStats(),
          }, null, 2) }],
        };
      }

      case 'goodflows_queue_next': {
        const queue = activeQueues.get(args.queueId);
        if (!queue) {
          return {
            content: [{ type: 'text', text: JSON.stringify({ error: 'Queue not found' }, null, 2) }],
            isError: true,
          };
        }
        const item = queue.peek();
        if (!item) {
          return {
            content: [{ type: 'text', text: JSON.stringify({ empty: true, stats: queue.getStats() }, null, 2) }],
          };
        }
        return {
          content: [{ type: 'text', text: JSON.stringify({ item, stats: queue.getStats() }, null, 2) }],
        };
      }

      case 'goodflows_queue_complete': {
        const queue = activeQueues.get(args.queueId);
        if (!queue) {
          return {
            content: [{ type: 'text', text: JSON.stringify({ error: 'Queue not found' }, null, 2) }],
            isError: true,
          };
        }
        queue.dequeue();
        return {
          content: [{ type: 'text', text: JSON.stringify({ success: true, stats: queue.getStats() }, null, 2) }],
        };
      }

      case 'goodflows_queue_fail': {
        const queue = activeQueues.get(args.queueId);
        if (!queue) {
          return {
            content: [{ type: 'text', text: JSON.stringify({ error: 'Queue not found' }, null, 2) }],
            isError: true,
          };
        }
        const item = queue.peek();
        if (item) {
          item._retries = (item._retries || 0) + 1;
          if (item._retries >= 3) {
            queue.dequeue(); // Give up after 3 retries
            return {
              content: [{ type: 'text', text: JSON.stringify({ exhausted: true, item, stats: queue.getStats() }, null, 2) }],
            };
          }
        }
        return {
          content: [{ type: 'text', text: JSON.stringify({ retrying: true, attempt: item?._retries, stats: queue.getStats() }, null, 2) }],
        };
      }

      case 'goodflows_queue_stats': {
        const queue = activeQueues.get(args.queueId);
        if (!queue) {
          return {
            content: [{ type: 'text', text: JSON.stringify({ error: 'Queue not found' }, null, 2) }],
            isError: true,
          };
        }
        return {
          content: [{ type: 'text', text: JSON.stringify(queue.getStats(), null, 2) }],
        };
      }

      // ========== Stats Handler ==========
      case 'goodflows_stats': {
        const contextStats = contextStore.getStats();
        const patternStats = patternTracker.getStats();
        const projectContext = getProjectContext();
        return {
          content: [{ type: 'text', text: JSON.stringify({
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
          }, null, 2) }],
        };
      }

      // ========== Project Info Handler ==========
      case 'goodflows_project_info': {
        // Force refresh if requested
        if (args.refresh) {
          projectInfo = null;
          gitHubInfo = null;
        }

        const context = getProjectContext();
        return {
          content: [{ type: 'text', text: JSON.stringify(context, null, 2) }],
        };
      }

      // ========== LLM Handoff Handlers ==========
      case 'goodflows_export_handoff': {
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
            });
          }
        } else {
          // Export all active sessions
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
          }));
        }

        // Build handoff package
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
            sessions.length > 0
              ? `Resume session: goodflows_session_resume({ sessionId: "${sessions[0]?.id}" })`
              : 'Start new session: goodflows_session_start({ trigger: "handoff-resume" })',
            'Use goodflows_get_tracking_summary() to see current progress',
          ],
        };

        return {
          content: [{ type: 'text', text: JSON.stringify(handoff, null, 2) }],
        };
      }

      case 'goodflows_generate_resume_prompt': {
        const projectContext = getProjectContext();
        const style = args.style || 'concise';
        const includeFiles = args.includeFiles !== false;

        // Get session data if specified
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

        // Get recent findings for context
        const recentFindings = contextStore.query({ status: 'open', limit: 5 });

        // Build the prompt based on style
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

        return {
          content: [{ type: 'text', text: prompt }],
        };
      }

      // ========== Linear Sync Handler ==========
      case 'goodflows_sync_linear': {
        try {
          let issues = [];

          // Mode 1: Pre-fetched issues from Linear MCP (preferred)
          if (args.issues && Array.isArray(args.issues) && args.issues.length > 0) {
            issues = args.issues;
          }
          // Mode 2: Direct API call (requires LINEAR_API_KEY)
          else {
            const linearApiKey = process.env.LINEAR_API_KEY;
            if (!linearApiKey) {
              return {
                content: [{ type: 'text', text: JSON.stringify({
                  error: 'No issues provided and LINEAR_API_KEY not set',
                  hint: 'Either pass issues fetched from Linear MCP, or set LINEAR_API_KEY',
                  example: 'First: linear-server.list_issues({ team: "GOO" }), then: goodflows_sync_linear({ issues: [...] })',
                }, null, 2) }],
                isError: true,
              };
            }

            if (!args.team) {
              return {
                content: [{ type: 'text', text: JSON.stringify({
                  error: 'team parameter required for direct API call',
                }, null, 2) }],
                isError: true,
              };
            }

            // Fetch issues from Linear API
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
              return {
                content: [{ type: 'text', text: JSON.stringify({ error: data.errors }, null, 2) }],
                isError: true,
              };
            }

            issues = data.data?.team?.issues?.nodes || [];
          }

          let synced = 0;
          let skipped = 0;

          for (const issue of issues) {
            // Normalize issue structure (handle both Linear API and MCP formats)
            const issueId = issue.identifier || issue.id;
            const issueTitle = issue.title;
            const issueState = issue.state?.name || issue.state;
            const issueCreatedAt = issue.createdAt;

            // Get labels (handle both { nodes: [...] } and direct array formats)
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

            // Map labels to finding type
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

          return {
            content: [{ type: 'text', text: JSON.stringify({
              success: true,
              team: args.team || 'from-mcp',
              synced,
              skipped,
              total: issues.length,
              source: args.issues ? 'pre-fetched' : 'api',
            }, null, 2) }],
          };
        } catch (error) {
          return {
            content: [{ type: 'text', text: JSON.stringify({ error: error.message }, null, 2) }],
            isError: true,
          };
        }
      }

      // ========== Auto Index Handler ==========
      case 'goodflows_auto_index': {
        if (args.enabled !== undefined) {
          autoIndexConfig.enabled = args.enabled;
        }
        if (args.sources) {
          autoIndexConfig.sources = args.sources;
        }
        if (args.sessionId) {
          autoIndexConfig.sessionId = args.sessionId;
        }

        // Save config to disk for persistence
        const configPath = join(process.cwd(), '.goodflows', 'auto-index.json');
        try {
          const { writeFileSync, mkdirSync } = await import('fs');
          const { dirname } = await import('path');
          mkdirSync(dirname(configPath), { recursive: true });
          writeFileSync(configPath, JSON.stringify(autoIndexConfig, null, 2));
        } catch (e) {
          // Ignore write errors
        }

        return {
          content: [{ type: 'text', text: JSON.stringify({
            success: true,
            config: autoIndexConfig,
          }, null, 2) }],
        };
      }

      // ========== Easy Tracking Handlers ==========
      case 'goodflows_track_file': {
        const session = activeSessions.get(args.sessionId);
        if (!session) {
          return {
            content: [{ type: 'text', text: JSON.stringify({ error: 'Session not found' }, null, 2) }],
            isError: true,
          };
        }
        session.trackFile(args.path, args.action || 'modified', args.meta || {});
        return {
          content: [{ type: 'text', text: JSON.stringify({
            success: true,
            tracked: { path: args.path, action: args.action || 'modified' },
          }, null, 2) }],
        };
      }

      case 'goodflows_track_files': {
        const session = activeSessions.get(args.sessionId);
        if (!session) {
          return {
            content: [{ type: 'text', text: JSON.stringify({ error: 'Session not found' }, null, 2) }],
            isError: true,
          };
        }
        session.trackFiles(args.paths, args.action || 'modified', args.meta || {});
        return {
          content: [{ type: 'text', text: JSON.stringify({
            success: true,
            tracked: { paths: args.paths, action: args.action || 'modified', count: args.paths.length },
          }, null, 2) }],
        };
      }

      case 'goodflows_track_issue': {
        const session = activeSessions.get(args.sessionId);
        if (!session) {
          return {
            content: [{ type: 'text', text: JSON.stringify({ error: 'Session not found' }, null, 2) }],
            isError: true,
          };
        }
        session.trackIssue(args.issueId, args.action || 'created', args.meta || {});
        return {
          content: [{ type: 'text', text: JSON.stringify({
            success: true,
            tracked: { issueId: args.issueId, action: args.action || 'created' },
          }, null, 2) }],
        };
      }

      case 'goodflows_track_finding': {
        const session = activeSessions.get(args.sessionId);
        if (!session) {
          return {
            content: [{ type: 'text', text: JSON.stringify({ error: 'Session not found' }, null, 2) }],
            isError: true,
          };
        }
        session.trackFinding(args.finding);
        return {
          content: [{ type: 'text', text: JSON.stringify({
            success: true,
            tracked: { type: args.finding.type, file: args.finding.file },
          }, null, 2) }],
        };
      }

      case 'goodflows_start_work': {
        const session = activeSessions.get(args.sessionId);
        if (!session) {
          return {
            content: [{ type: 'text', text: JSON.stringify({ error: 'Session not found' }, null, 2) }],
            isError: true,
          };
        }
        session.startWork(args.type, args.meta || {});
        const currentWork = session.getCurrentWork();
        return {
          content: [{ type: 'text', text: JSON.stringify({
            success: true,
            work: currentWork,
          }, null, 2) }],
        };
      }

      case 'goodflows_complete_work': {
        const session = activeSessions.get(args.sessionId);
        if (!session) {
          return {
            content: [{ type: 'text', text: JSON.stringify({ error: 'Session not found' }, null, 2) }],
            isError: true,
          };
        }
        const summary = session.completeWork(args.result || {});
        return {
          content: [{ type: 'text', text: JSON.stringify({
            success: true,
            summary,
          }, null, 2) }],
        };
      }

      case 'goodflows_get_tracking_summary': {
        const session = activeSessions.get(args.sessionId);
        if (!session) {
          return {
            content: [{ type: 'text', text: JSON.stringify({ error: 'Session not found' }, null, 2) }],
            isError: true,
          };
        }
        const summary = session.getTrackingSummary();
        const currentWork = session.getCurrentWork();
        const completedWork = session.getCompletedWork();
        return {
          content: [{ type: 'text', text: JSON.stringify({
            summary,
            currentWork,
            completedWork,
          }, null, 2) }],
        };
      }

      default:
        return {
          content: [{ type: 'text', text: JSON.stringify({ error: `Unknown tool: ${name}` }, null, 2) }],
          isError: true,
        };
    }
  } catch (error) {
    return {
      content: [{ type: 'text', text: JSON.stringify({ error: error.message, stack: error.stack }, null, 2) }],
      isError: true,
    };
  }
});

// Start the server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('GoodFlows MCP Server running on stdio');
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
