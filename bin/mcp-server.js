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
import { existsSync, readFileSync, mkdirSync } from 'fs';

import { ContextStore } from '../lib/context-store.js';
import { SessionContextManager } from '../lib/session-context.js';
import { PatternTracker } from '../lib/pattern-tracker.js';
import { PriorityQueue } from '../lib/priority-queue.js';
import { PlanExecutor } from '../lib/plan-executor.js';
import { ContextFileManager } from '../lib/context-files.js';
import { parseTask, validateTask, generateTaskPrompt } from '../lib/xml-task-parser.js';
import { findLinearMatches, getMatchRecommendation } from '../lib/context-index.js';

// ─────────────────────────────────────────────────────────────
// Working Directory Resolution
// ─────────────────────────────────────────────────────────────

/**
 * Get the project working directory from args, env, or cwd
 * Priority: --project arg > GOODFLOWS_PROJECT env > cwd (if .git exists) > home dir
 */
function resolveWorkingDirectory() {
  // Check for --project argument
  const projectArgIndex = process.argv.indexOf('--project');
  if (projectArgIndex !== -1 && process.argv[projectArgIndex + 1]) {
    const projectDir = process.argv[projectArgIndex + 1];
    if (existsSync(projectDir)) {
      return projectDir;
    }
  }

  // Check for GOODFLOWS_PROJECT environment variable
  if (process.env.GOODFLOWS_PROJECT && existsSync(process.env.GOODFLOWS_PROJECT)) {
    return process.env.GOODFLOWS_PROJECT;
  }

  // Check if current working directory is a valid project (has .git)
  const cwd = process.cwd();
  if (existsSync(join(cwd, '.git')) || existsSync(join(cwd, 'package.json'))) {
    return cwd;
  }

  // Fall back to home directory with .goodflows
  const homeDir = process.env.HOME || process.env.USERPROFILE || '/tmp';
  return homeDir;
}

const workingDirectory = resolveWorkingDirectory();
const goodflowsBasePath = join(workingDirectory, '.goodflows');

// Ensure base directory exists
try {
  if (!existsSync(goodflowsBasePath)) {
    mkdirSync(goodflowsBasePath, { recursive: true });
  }
} catch (e) {
  console.error(`Warning: Could not create ${goodflowsBasePath}: ${e.message}`);
}

// Change to working directory so relative paths work
try {
  process.chdir(workingDirectory);
} catch (e) {
  console.error(`Warning: Could not change to ${workingDirectory}: ${e.message}`);
}

// Initialize GoodFlows components with safe paths
let contextStore, patternTracker, contextFileManager;

try {
  contextStore = new ContextStore({ basePath: join(goodflowsBasePath, 'context') });
} catch (e) {
  console.error(`Warning: ContextStore init failed: ${e.message}`);
  contextStore = { query: () => [], addFinding: () => ({ added: false }), getStats: () => ({}) };
}

try {
  patternTracker = new PatternTracker({ basePath: join(goodflowsBasePath, 'context', 'patterns') });
} catch (e) {
  console.error(`Warning: PatternTracker init failed: ${e.message}`);
  patternTracker = { recommend: () => [], getStats: () => ({}) };
}

try {
  // ContextFileManager expects the parent dir (it adds .goodflows internally)
  contextFileManager = new ContextFileManager({ basePath: workingDirectory });
} catch (e) {
  console.error(`Warning: ContextFileManager init failed: ${e.message}`);
  contextFileManager = { read: () => ({}), write: () => ({}), status: () => ({}) };
}

// Active sessions, queues, and plan executor (in-memory for current process)
const activeSessions = new Map();
const activeQueues = new Map();

let planExecutor;
try {
  planExecutor = new PlanExecutor({ basePath: join(goodflowsBasePath, 'context', 'plans') });
} catch (e) {
  console.error(`Warning: PlanExecutor init failed: ${e.message}`);
  planExecutor = { createPlan: () => ({}), execute: () => ({}), getStatus: () => ({}) };
}

// Auto-index configuration (loaded from disk if exists)
let autoIndexConfig = {
  enabled: false,
  sources: ['linear', 'coderabbit', 'fixes'],
  sessionId: null,
};

// Load existing auto-index config
const autoIndexConfigPath = join(goodflowsBasePath, 'auto-index.json');
if (existsSync(autoIndexConfigPath)) {
  try {
    autoIndexConfig = JSON.parse(readFileSync(autoIndexConfigPath, 'utf-8'));
  } catch {
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
    } catch {
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
      const remoteMatch = gitConfig.match(/\[remote "origin"\][^[]*url\s*=\s*(.+)/m);
      if (remoteMatch) {
        const remoteUrl = remoteMatch[1].trim();
        info.remote = remoteUrl;

        // Parse GitHub URL (supports https and ssh formats)
        // https://github.com/owner/repo.git
        // git@github.com:owner/repo.git
        const httpsMatch = remoteUrl.match(/github\.com\/([^/]+)\/([^/.]+)/);
        const sshMatch = remoteUrl.match(/github\.com:([^/]+)\/([^/.]+)/);

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
    } catch {
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
    } catch {
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
  },
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
          description: 'What action you intend to take'
        },
        findings: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              file: { type: 'string', description: 'File path' },
              description: { type: 'string', description: 'Finding description' },
              type: { type: 'string', description: 'Finding type' }
            }
          },
          description: 'Findings/actions you intend to process'
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
              url: { type: 'string' }
            }
          }
        },
        options: {
          type: 'object',
          properties: {
            similarityThreshold: { type: 'number', description: 'Similarity threshold 0-1 (default: 0.5)' },
            includeInProgress: { type: 'boolean', description: 'Include in-progress issues (default: true)' },
            includeDone: { type: 'boolean', description: 'Include done issues (default: false)' },
            forceRefresh: { type: 'boolean', description: 'Bypass cache and refresh (default: false)' }
          }
        }
      },
      required: ['action', 'findings', 'sessionId']
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

  // ========== Plan Execution Tools ==========
  {
    name: 'goodflows_plan_create',
    description: `Create an execution plan from a complex task.

Automatically splits complex tasks into max 3 subtasks, each executed in a fresh subagent context.
This prevents context degradation by ensuring each subtask gets a full 200k token window.

Examples:
- { "task": "Review codebase, fix security issues, add tests", "sessionId": "..." }
- { "task": "Refactor auth module and update documentation", "sessionId": "...", "maxSubtasks": 2 }`,
    inputSchema: {
      type: 'object',
      properties: {
        task: { type: 'string', description: 'Complex task description' },
        sessionId: { type: 'string', description: 'Parent session ID' },
        maxSubtasks: { type: 'number', description: 'Maximum subtasks (default: 3, max: 3)' },
        priorityThreshold: { type: 'number', description: 'Only include subtasks at or above this priority (1-4)' },
        context: { type: 'object', description: 'Additional context to pass to subtasks' },
      },
      required: ['task', 'sessionId'],
    },
  },
  {
    name: 'goodflows_plan_execute',
    description: `Start executing a plan.

By default runs asynchronously - returns immediately with plan ID.
Use goodflows_plan_status to monitor progress. Walk away and come back to completed work.

Example: { "planId": "plan_xxx" }`,
    inputSchema: {
      type: 'object',
      properties: {
        planId: { type: 'string', description: 'Plan ID to execute' },
        async: { type: 'boolean', description: 'Run asynchronously (default: true)' },
      },
      required: ['planId'],
    },
  },
  {
    name: 'goodflows_plan_status',
    description: `Get current plan status and progress.

Shows:
- Overall plan status (pending, running, completed, partial, failed, cancelled)
- Progress counts (completed, running, pending, failed, blocked subtasks)
- Individual subtask statuses

Use this to monitor async plan execution.`,
    inputSchema: {
      type: 'object',
      properties: {
        planId: { type: 'string', description: 'Plan ID' },
      },
      required: ['planId'],
    },
  },
  {
    name: 'goodflows_plan_subtask_result',
    description: 'Get the result of a specific completed subtask',
    inputSchema: {
      type: 'object',
      properties: {
        planId: { type: 'string', description: 'Plan ID' },
        subtaskId: { type: 'string', description: 'Subtask ID' },
      },
      required: ['planId', 'subtaskId'],
    },
  },
  {
    name: 'goodflows_plan_cancel',
    description: `Cancel a running plan.

Completed subtasks are preserved. Pending subtasks are marked as skipped.
Use this to stop execution if something goes wrong.`,
    inputSchema: {
      type: 'object',
      properties: {
        planId: { type: 'string', description: 'Plan ID' },
        reason: { type: 'string', description: 'Cancellation reason' },
      },
      required: ['planId'],
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
    name: 'goodflows_plan_parse',
    description: `Parse the XML task definition from PLAN.md.

Returns structured task object with:
- name, type, context, scope, action, verify, done, tracking

Also validates the task and provides warnings/suggestions.`,
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'goodflows_plan_generate_prompt',
    description: 'Generate an agent prompt from the parsed PLAN.md task',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'goodflows_plan_create_xml',
    description: `Create an XML task template for PLAN.md.

Generates structured XML task definition with:
- name, type, context, scope, action, verify, done, tracking

Example input:
{
  "name": "Add user authentication",
  "type": "implementation",
  "why": "Users need to log in securely",
  "files": [{ "path": "src/auth.ts", "action": "create" }],
  "action": "1. Create auth module\\n2. Add JWT handling",
  "checks": [{ "type": "command", "value": "npm test" }],
  "done": "Users can log in and receive JWT token"
}`,
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Task name' },
        type: {
          type: 'string',
          enum: ['implementation', 'fix', 'refactor', 'review'],
          description: 'Task type (default: implementation)',
        },
        why: { type: 'string', description: 'Why this task matters' },
        dependsOn: { type: 'string', description: 'Prerequisites' },
        session: { type: 'string', description: 'Session ID' },
        files: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              path: { type: 'string' },
              action: { type: 'string', enum: ['create', 'modify', 'delete'] },
            },
          },
          description: 'Files to create/modify/delete',
        },
        boundaries: { type: 'string', description: 'What NOT to touch' },
        action: { type: 'string', description: 'Step-by-step instructions' },
        checks: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              type: { type: 'string', enum: ['command', 'manual', 'file_exists'] },
              value: { type: 'string' },
            },
          },
          description: 'Verification checks',
        },
        done: { type: 'string', description: 'Definition of done' },
        trackGoodflows: { type: 'boolean', description: 'Enable GoodFlows tracking (default: true)' },
        writeToPlan: { type: 'boolean', description: 'Write to PLAN.md (default: false)' },
      },
      required: ['name', 'action', 'done'],
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
        // Run pre-handoff hook if exists
        const preHookPath = join(process.cwd(), 'bin', 'hooks', 'pre-handoff.js');
        if (existsSync(preHookPath)) {
          try {
            const { execSync } = await import('child_process');
            // Execute the hook, capturing output but not failing the export if it warns
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
              // Include raw context for full restoration
              rawContext: session.session?.context,
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
            _hash: f._hash, // Keep hash for stable dedup
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
            'Run: goodflows_import_handoff({ content: <JSON> }) to restore state',
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

      case 'goodflows_import_handoff': {
        try {
          const content = typeof args.content === 'string' 
            ? JSON.parse(args.content) 
            : args.content;

          // 1. Restore sessions
          const restoredSessions = [];
          if (content.sessions && Array.isArray(content.sessions)) {
            const { writeFileSync, mkdirSync } = await import('fs');
            const { join } = await import('path');
            const sessionsDir = join(goodflowsBasePath, 'context', 'sessions');
            mkdirSync(sessionsDir, { recursive: true });

            for (const sessionData of content.sessions) {
              const sessionId = args.sessionId || sessionData.id;
              
              // Reconstruct full session object compatible with SessionContextManager
              const fullSession = {
                id: sessionId,
                state: sessionData.state || 'running',
                metadata: sessionData.metadata || {},
                timestamps: {
                  created: new Date().toISOString(), // Or from metadata if available
                  started: new Date().toISOString(),
                  updated: new Date().toISOString(),
                },
                context: sessionData.rawContext || {}, // Restore full context
                invocations: [], // We don't strictly need history for basic functionality
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

          // 2. Restore findings (if any)
          let findingsRestored = 0;
          if (content.findings && Array.isArray(content.findings)) {
            for (const finding of content.findings) {
              // Add finding (dedup is handled by contextStore)
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

          return {
            content: [{ type: 'text', text: JSON.stringify({
              success: true,
              sessionsRestored: restoredSessions,
              findingsRestored,
              hookStatus: hookResult,
              nextSteps: restoredSessions.length > 0 
                ? `Resume with: goodflows_session_resume({ sessionId: "${restoredSessions[0]}" })`
                : 'Start new session: goodflows_session_start()',
            }, null, 2) }],
          };

        } catch (error) {
          return {
            content: [{ type: 'text', text: JSON.stringify({ error: `Import failed: ${error.message}` }, null, 2) }],
            isError: true,
          };
        }
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

      // ========== Linear Team Resolution Handler ==========
      case 'goodflows_resolve_linear_team': {
        try {
          const teamInput = args.team;
          let teams = args.teams;

          // If no pre-fetched teams, we need them passed from Linear MCP
          if (!teams || !Array.isArray(teams) || teams.length === 0) {
            return {
              content: [{ type: 'text', text: JSON.stringify({
                resolved: false,
                error: 'No teams provided. First call linear_list_teams() then pass the result.',
                hint: 'const teams = await linear_list_teams(); await goodflows_resolve_linear_team({ team: "GOO", teams })',
                input: teamInput,
              }, null, 2) }],
              isError: true,
            };
          }

          // Try to find matching team by key, name, or ID
          const inputLower = teamInput.toLowerCase();
          const resolved = teams.find(t =>
            t.key === teamInput ||
            t.key?.toLowerCase() === inputLower ||
            t.name === teamInput ||
            t.name?.toLowerCase() === inputLower ||
            t.id === teamInput
          );

          if (!resolved) {
            const availableTeams = teams.map(t => `${t.name} (key: ${t.key})`).join(', ');
            return {
              content: [{ type: 'text', text: JSON.stringify({
                resolved: false,
                error: `Team "${teamInput}" not found`,
                availableTeams,
                hint: `Use one of: ${availableTeams}`,
              }, null, 2) }],
              isError: true,
            };
          }

          return {
            content: [{ type: 'text', text: JSON.stringify({
              resolved: true,
              id: resolved.id,
              name: resolved.name,
              key: resolved.key,
              input: teamInput,
              message: `Resolved "${teamInput}" to team "${resolved.name}" (${resolved.key})`,
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
        } catch {
          // Ignore write errors
        }

        return {
          content: [{ type: 'text', text: JSON.stringify({
            success: true,
            config: autoIndexConfig,
          }, null, 2) }],
        };
      }

      // ========== Preflight Check Handler ==========
      case 'goodflows_preflight_check': {
        try {
          const { action, findings, sessionId, team, linearIssues, options = {} } = args;
          const {
            similarityThreshold = 0.5,
            includeInProgress = true,
            includeDone = false,
            forceRefresh = false
          } = options;

          // Validate inputs
          if (!findings || !Array.isArray(findings) || findings.length === 0) {
            return {
              content: [{ type: 'text', text: JSON.stringify({
                status: 'clear',
                conflicts: [],
                clear: [],
                summary: { total: 0, conflicts: 0, clear: 0 },
                requiresConfirmation: false,
                message: 'No findings to check'
              }, null, 2) }],
            };
          }

          // Get session for caching
          const session = activeSessions.get(sessionId);
          const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

          // Try to get cached issues
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

          // Use provided issues or cached issues
          if (!issues) {
            if (linearIssues && Array.isArray(linearIssues) && linearIssues.length > 0) {
              issues = linearIssues;
              // Cache for future calls
              if (session) {
                session.set('preflight.linearIssuesCache', issues);
                session.set('preflight.cacheTimestamp', Date.now());
              }
              cacheInfo = { hit: false, source: 'provided' };
            } else {
              // No issues available - return clear (can't check)
              return {
                content: [{ type: 'text', text: JSON.stringify({
                  status: 'clear',
                  conflicts: [],
                  clear: findings,
                  summary: { total: findings.length, conflicts: 0, clear: findings.length },
                  requiresConfirmation: false,
                  warning: 'No Linear issues provided for comparison. Pass linearIssues from linear_list_issues() for accurate conflict detection.',
                  cache: cacheInfo
                }, null, 2) }],
              };
            }
          }

          // Build status filter
          const includeStatus = ['Backlog', 'Todo', 'backlog', 'todo', 'unstarted'];
          if (includeInProgress) {
            includeStatus.push('In Progress', 'in progress', 'started');
          }
          if (includeDone) {
            includeStatus.push('Done', 'done', 'completed', 'Canceled', 'canceled');
          }

          // Check each finding for conflicts
          const conflicts = [];
          const clear = [];

          for (const finding of findings) {
            const matches = findLinearMatches(finding, issues, {
              threshold: similarityThreshold,
              includeStatus
            });

            if (matches.length > 0) {
              // Get recommendation for each match
              const enrichedMatches = matches.map(m => ({
                ...m,
                recommendation: getMatchRecommendation(action, m)
              }));

              conflicts.push({
                finding,
                matches: enrichedMatches,
                bestMatch: enrichedMatches[0],
                recommendation: enrichedMatches[0].recommendation
              });
            } else {
              clear.push(finding);
            }
          }

          // Build user-friendly conflict summary for prompting
          let conflictSummary = null;
          if (conflicts.length > 0) {
            conflictSummary = conflicts.map((c, i) => {
              const match = c.bestMatch;
              return {
                index: i + 1,
                finding: `${c.finding.file}: ${c.finding.description?.slice(0, 50)}...`,
                matchedIssue: match.issue.id,
                matchedTitle: match.issue.title,
                matchType: match.type,
                similarity: `${Math.round(match.similarity * 100)}%`,
                issueStatus: match.issue.status,
                issueUrl: match.issue.url,
                recommendation: match.recommendation
              };
            });
          }

          // Store preflight results in session
          if (session) {
            session.set('preflight.lastCheck', {
              action,
              timestamp: Date.now(),
              conflictsFound: conflicts.length,
              clearCount: clear.length
            });
          }

          return {
            content: [{ type: 'text', text: JSON.stringify({
              status: conflicts.length > 0 ? 'conflicts_found' : 'clear',
              conflicts,
              clear,
              summary: {
                total: findings.length,
                conflicts: conflicts.length,
                clear: clear.length
              },
              requiresConfirmation: conflicts.length > 0,
              conflictSummary,
              cache: {
                ...cacheInfo,
                issueCount: issues.length
              },
              promptOptions: conflicts.length > 0 ? [
                { id: 'skip', label: 'Skip conflicts', description: `Process only ${clear.length} clear findings` },
                { id: 'link', label: 'Link to existing', description: 'Add comments to existing issues instead' },
                { id: 'force', label: 'Force create', description: 'Create anyway (marked as potential duplicate)' },
                { id: 'abort', label: 'Abort', description: 'Stop workflow entirely' }
              ] : null
            }, null, 2) }],
          };
        } catch (error) {
          return {
            content: [{ type: 'text', text: JSON.stringify({
              status: 'error',
              error: error.message,
              stack: error.stack
            }, null, 2) }],
            isError: true,
          };
        }
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
        
        // Invalidate preflight cache when issues are created/updated/fixed
        // This ensures next preflight check gets fresh data from Linear
        const cacheInvalidatingActions = ['created', 'fixed', 'updated'];
        if (cacheInvalidatingActions.includes(args.action)) {
          session.set('preflight.linearIssuesCache', null);
          session.set('preflight.cacheTimestamp', null);
        }
        
        return {
          content: [{ type: 'text', text: JSON.stringify({
            success: true,
            tracked: { issueId: args.issueId, action: args.action || 'created' },
            cacheInvalidated: cacheInvalidatingActions.includes(args.action),
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

      // ========== Plan Execution Handlers ==========
      case 'goodflows_plan_create': {
        try {
          // Get session manager if session is active
          const session = activeSessions.get(args.sessionId);
          if (session) {
            planExecutor.sessionManager = session;
          }

          const plan = await planExecutor.createPlan(args.task, args.sessionId, {
            maxSubtasks: args.maxSubtasks,
            priorityThreshold: args.priorityThreshold,
            context: args.context,
          });

          return {
            content: [{ type: 'text', text: JSON.stringify({
              planId: plan.id,
              status: plan.status,
              complexity: plan.originalTask.complexity,
              subtaskCount: plan.subtasks.length,
              subtasks: plan.subtasks.map(st => ({
                id: st.id,
                sequence: st.sequence,
                priority: st.priority,
                description: st.description.slice(0, 100),
                agentType: st.agentType,
                dependencies: st.dependencies,
              })),
              message: `Plan created with ${plan.subtasks.length} subtasks. Use goodflows_plan_execute to start.`,
            }, null, 2) }],
          };
        } catch (error) {
          return {
            content: [{ type: 'text', text: JSON.stringify({ error: error.message }, null, 2) }],
            isError: true,
          };
        }
      }

      case 'goodflows_plan_execute': {
        try {
          const session = activeSessions.get(args.sessionId);
          if (session) {
            planExecutor.sessionManager = session;
          }

          const result = await planExecutor.execute(args.planId, {
            async: args.async !== false,
          });

          return {
            content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
          };
        } catch (error) {
          return {
            content: [{ type: 'text', text: JSON.stringify({ error: error.message }, null, 2) }],
            isError: true,
          };
        }
      }

      case 'goodflows_plan_status': {
        const status = planExecutor.getStatus(args.planId);
        return {
          content: [{ type: 'text', text: JSON.stringify(status, null, 2) }],
        };
      }

      case 'goodflows_plan_subtask_result': {
        const result = planExecutor.getSubtaskResult(args.planId, args.subtaskId);
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        };
      }

      case 'goodflows_plan_cancel': {
        try {
          const result = await planExecutor.cancel(args.planId, args.reason);
          return {
            content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
          };
        } catch (error) {
          return {
            content: [{ type: 'text', text: JSON.stringify({ error: error.message }, null, 2) }],
            isError: true,
          };
        }
      }

      // ========== Context File Handlers ==========
      case 'goodflows_context_file_read': {
        try {
          const result = await contextFileManager.read(args.file);
          return {
            content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
          };
        } catch (error) {
          return {
            content: [{ type: 'text', text: JSON.stringify({ error: error.message }, null, 2) }],
            isError: true,
          };
        }
      }

      case 'goodflows_context_file_write': {
        try {
          const result = await contextFileManager.write(args.file, args.content, {
            allowOversize: args.allowOversize,
          });
          return {
            content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
          };
        } catch (error) {
          return {
            content: [{ type: 'text', text: JSON.stringify({ error: error.message }, null, 2) }],
            isError: true,
          };
        }
      }

      case 'goodflows_context_file_status': {
        try {
          const result = await contextFileManager.status();
          return {
            content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
          };
        } catch (error) {
          return {
            content: [{ type: 'text', text: JSON.stringify({ error: error.message }, null, 2) }],
            isError: true,
          };
        }
      }

      case 'goodflows_context_file_init': {
        try {
          const result = await contextFileManager.init({ force: args.force });
          return {
            content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
          };
        } catch (error) {
          return {
            content: [{ type: 'text', text: JSON.stringify({ error: error.message }, null, 2) }],
            isError: true,
          };
        }
      }

      case 'goodflows_state_update': {
        try {
          const result = await contextFileManager.updateState(args);
          return {
            content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
          };
        } catch (error) {
          return {
            content: [{ type: 'text', text: JSON.stringify({ error: error.message }, null, 2) }],
            isError: true,
          };
        }
      }

      case 'goodflows_summary_add': {
        try {
          const result = await contextFileManager.addSummary({
            task: args.task,
            status: args.status,
            changes: args.changes,
            verification: args.verification,
            notes: args.notes,
          });
          return {
            content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
          };
        } catch (error) {
          return {
            content: [{ type: 'text', text: JSON.stringify({ error: error.message }, null, 2) }],
            isError: true,
          };
        }
      }

      case 'goodflows_plan_parse': {
        try {
          const planFile = await contextFileManager.read('PLAN');
          if (!planFile.exists || !planFile.content) {
            return {
              content: [{ type: 'text', text: JSON.stringify({ error: 'PLAN.md not found or empty' }, null, 2) }],
              isError: true,
            };
          }
          const parsed = parseTask(planFile.content);
          const validation = validateTask(parsed);
          return {
            content: [{ type: 'text', text: JSON.stringify({
              ...parsed,
              validation,
            }, null, 2) }],
          };
        } catch (error) {
          return {
            content: [{ type: 'text', text: JSON.stringify({ error: error.message }, null, 2) }],
            isError: true,
          };
        }
      }

      case 'goodflows_plan_generate_prompt': {
        try {
          const planFile = await contextFileManager.read('PLAN');
          if (!planFile.exists || !planFile.content) {
            return {
              content: [{ type: 'text', text: JSON.stringify({ error: 'PLAN.md not found or empty' }, null, 2) }],
              isError: true,
            };
          }
          const parsed = parseTask(planFile.content);
          if (!parsed.valid) {
            return {
              content: [{ type: 'text', text: JSON.stringify({ error: 'Invalid task', details: parsed }, null, 2) }],
              isError: true,
            };
          }
          const prompt = generateTaskPrompt(parsed);
          return {
            content: [{ type: 'text', text: prompt }],
          };
        } catch (error) {
          return {
            content: [{ type: 'text', text: JSON.stringify({ error: error.message }, null, 2) }],
            isError: true,
          };
        }
      }

      case 'goodflows_plan_create_xml': {
        try {
          const { createTaskXml } = await import('../lib/xml-task-parser.js');

          const xml = createTaskXml({
            type: args.type || 'implementation',
            name: args.name,
            why: args.why,
            dependsOn: args.dependsOn,
            session: args.session,
            files: args.files || [],
            boundaries: args.boundaries,
            action: args.action,
            checks: args.checks || [],
            done: args.done,
            trackGoodflows: args.trackGoodflows !== false,
          });

          // Optionally write to PLAN.md
          if (args.writeToPlan) {
            await contextFileManager.write('PLAN', xml, { allowOversize: true });
            return {
              content: [{ type: 'text', text: JSON.stringify({
                success: true,
                writtenTo: '.goodflows/PLAN.md',
                xml,
              }, null, 2) }],
            };
          }

          return {
            content: [{ type: 'text', text: xml }],
          };
        } catch (error) {
          return {
            content: [{ type: 'text', text: JSON.stringify({ error: error.message }, null, 2) }],
            isError: true,
          };
        }
      }

      case 'goodflows_autoload_context': {
        try {
          const result = await contextFileManager.getAutoLoadContext({
            agentType: args.agentType,
            isPlanning: args.isPlanning,
            hasTask: args.hasTask,
          });
          return {
            content: [{ type: 'text', text: JSON.stringify({
              tokens: result.tokens,
              filesLoaded: result.filesLoaded,
              content: result.content,
            }, null, 2) }],
          };
        } catch (error) {
          return {
            content: [{ type: 'text', text: JSON.stringify({ error: error.message }, null, 2) }],
            isError: true,
          };
        }
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

  // Only log startup info if not in quiet mode (some MCP clients are sensitive to stderr)
  if (!process.env.GOODFLOWS_QUIET) {
    console.error(`GoodFlows MCP Server running on stdio`);
    console.error(`  Working directory: ${workingDirectory}`);
    console.error(`  GoodFlows path: ${goodflowsBasePath}`);
  }
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
