#!/usr/bin/env node
/**
 * GoodFlows MCP Server (Refactored)
 *
 * Uses modular handlers and tool registry for maintainable code.
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
import { PatternTracker } from '../lib/pattern-tracker.js';
import { ContextFileManager } from '../lib/context-files.js';
import {
  parseTask,
  validateTask,
  generateTaskPrompt,
  parseMultiTaskPlan,
  createMultiTaskPlanXml,
  createTaskXml,
} from '../lib/xml-task-parser.js';
import { findLinearMatches, getMatchRecommendation } from '../lib/context-index.js';
import { PhaseManager } from '../lib/phase-manager.js';
import { GsdExecutor } from '../lib/gsd-executor.js';
import { PlanExecutor } from '../lib/plan-executor.js';

import { ToolRegistry, mcpError } from './mcp/tool-registry.js';
import { registerAllHandlers } from './mcp/handlers/index.js';

// ─────────────────────────────────────────────────────────────
// Working Directory Resolution
// ─────────────────────────────────────────────────────────────

/**
 * Get the project working directory from args, env, or cwd
 */
function resolveWorkingDirectory() {
  const projectArgIndex = process.argv.indexOf('--project');
  if (projectArgIndex !== -1 && process.argv[projectArgIndex + 1]) {
    const projectDir = process.argv[projectArgIndex + 1];
    if (existsSync(projectDir)) return projectDir;
  }

  if (process.env.GOODFLOWS_PROJECT && existsSync(process.env.GOODFLOWS_PROJECT)) {
    return process.env.GOODFLOWS_PROJECT;
  }

  const cwd = process.cwd();
  if (existsSync(join(cwd, '.git')) || existsSync(join(cwd, 'package.json'))) {
    return cwd;
  }

  return process.env.HOME || process.env.USERPROFILE || '/tmp';
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

// Change to working directory
try {
  process.chdir(workingDirectory);
} catch (e) {
  console.error(`Warning: Could not change to ${workingDirectory}: ${e.message}`);
}

// ─────────────────────────────────────────────────────────────
// Initialize Services
// ─────────────────────────────────────────────────────────────

function createFallbackService(methods) {
  return methods.reduce((svc, method) => {
    svc[method] = () => ({ error: 'Service not initialized' });
    return svc;
  }, {});
}

let contextStore;
try {
  contextStore = new ContextStore({ basePath: join(goodflowsBasePath, 'context') });
} catch (e) {
  console.error(`Warning: ContextStore init failed: ${e.message}`);
  contextStore = createFallbackService(['query', 'addFinding', 'updateFinding', 'findSimilar', 'exportToMarkdown', 'getStats']);
}

let patternTracker;
try {
  patternTracker = new PatternTracker({ basePath: join(goodflowsBasePath, 'context', 'patterns') });
} catch (e) {
  console.error(`Warning: PatternTracker init failed: ${e.message}`);
  patternTracker = createFallbackService(['recommend', 'recordSuccess', 'recordFailure', 'addPattern', 'getStats']);
}

let contextFileManager;
try {
  contextFileManager = new ContextFileManager({ basePath: workingDirectory });
} catch (e) {
  console.error(`Warning: ContextFileManager init failed: ${e.message}`);
  contextFileManager = createFallbackService(['read', 'write', 'status', 'init', 'updateState', 'addSummary', 'getAutoLoadContext']);
}

let phaseManager;
try {
  phaseManager = new PhaseManager({ basePath: workingDirectory });
} catch (e) {
  console.error(`Warning: PhaseManager init failed: ${e.message}`);
  phaseManager = createFallbackService(['init', 'createPhase', 'listPhases', 'getPhase', 'createPlan', 'getPlan', 'createSummary', 'getCurrentPhase', 'getNextPlan', 'completePhase', 'getPhaseStatus', 'createMultiTaskPlan', 'updateRoadmap']);
}

let planExecutor;
try {
  planExecutor = new PlanExecutor({ basePath: join(goodflowsBasePath, 'context', 'plans') });
} catch (e) {
  console.error(`Warning: PlanExecutor init failed: ${e.message}`);
  planExecutor = createFallbackService(['createPlan', 'execute', 'getStatus', 'getSubtaskResult', 'cancel']);
}

let gsdExecutor;
try {
  gsdExecutor = new GsdExecutor({ basePath: workingDirectory, phaseManager });
} catch (e) {
  console.error(`Warning: GsdExecutor init failed: ${e.message}`);
  gsdExecutor = createFallbackService(['executePlan', 'commitTask', 'resumeCheckpoint']);
}

// In-memory state
const activeSessions = new Map();
const activeQueues = new Map();

// Auto-index config
let autoIndexConfig = {
  enabled: false,
  sources: ['linear', 'coderabbit', 'fixes'],
  sessionId: null,
};

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

function detectProjectInfo() {
  const cwd = process.cwd();
  const info = {
    name: null,
    version: null,
    description: null,
    directory: cwd,
    directoryName: cwd.split('/').pop(),
  };

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
      // Ignore
    }
  }

  if (!info.name) info.name = info.directoryName;
  return info;
}

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

  if (!existsSync(join(cwd, '.git'))) return info;
  info.isGitRepo = true;

  const gitConfigPath = join(cwd, '.git', 'config');
  if (existsSync(gitConfigPath)) {
    try {
      const gitConfig = readFileSync(gitConfigPath, 'utf-8');
      const remoteMatch = gitConfig.match(/\[remote "origin"\][^[]*url\s*=\s*(.+)/m);
      if (remoteMatch) {
        const remoteUrl = remoteMatch[1].trim();
        info.remote = remoteUrl;

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
      // Ignore
    }
  }

  const headPath = join(cwd, '.git', 'HEAD');
  if (existsSync(headPath)) {
    try {
      const head = readFileSync(headPath, 'utf-8').trim();
      const branchMatch = head.match(/ref: refs\/heads\/(.+)/);
      if (branchMatch) info.branch = branchMatch[1];
    } catch {
      // Ignore
    }
  }

  for (const branch of ['main', 'master', 'develop']) {
    if (existsSync(join(cwd, '.git', 'refs', 'heads', branch))) {
      info.defaultBranch = branch;
      break;
    }
  }

  return info;
}

let projectInfo = null;
let gitHubInfo = null;

function getProjectInfo() {
  if (!projectInfo) projectInfo = detectProjectInfo();
  return projectInfo;
}

function getGitHubInfo() {
  if (!gitHubInfo) gitHubInfo = detectGitHubInfo();
  return gitHubInfo;
}

function getProjectContext() {
  return {
    project: getProjectInfo(),
    github: getGitHubInfo(),
    cwd: process.cwd(),
    timestamp: new Date().toISOString(),
  };
}

function refreshProjectInfo() {
  projectInfo = null;
  gitHubInfo = null;
}

// ─────────────────────────────────────────────────────────────
// Service Container
// ─────────────────────────────────────────────────────────────

const services = {
  contextStore,
  patternTracker,
  contextFileManager,
  phaseManager,
  planExecutor,
  gsdExecutor,
  activeSessions,
  activeQueues,
  autoIndexConfig,
  workingDirectory,
  goodflowsBasePath,
  getProjectContext,
  refreshProjectInfo,
  findLinearMatches,
  getMatchRecommendation,
  parseTask,
  validateTask,
  generateTaskPrompt,
  parseMultiTaskPlan,
  createMultiTaskPlanXml,
  createTaskXml,
};

// ─────────────────────────────────────────────────────────────
// Tool Registry Setup
// ─────────────────────────────────────────────────────────────

const registry = new ToolRegistry();

// ─────────────────────────────────────────────────────────────
// MCP Server
// ─────────────────────────────────────────────────────────────

const server = new Server(
  {
    name: 'goodflows',
    version: '1.2.0',
  },
  {
    capabilities: {
      tools: {},
    },
  },
);

// Handle list tools request
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: registry.getAllTools(),
}));

// Handle tool calls using the registry
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    if (!registry.has(name)) {
      return mcpError(`Unknown tool: ${name}`, 'UNKNOWN_TOOL');
    }

    const result = await registry.handle(name, args || {}, services);
    return result;
  } catch (error) {
    return mcpError(error.message, 'HANDLER_ERROR');
  }
});

// ─────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────

async function main() {
  // Register all handlers
  await registerAllHandlers(registry);

  if (!process.env.GOODFLOWS_QUIET) {
    console.error(`GoodFlows MCP Server (Refactored) running on stdio`);
    console.error(`  Working directory: ${workingDirectory}`);
    console.error(`  GoodFlows path: ${goodflowsBasePath}`);
    console.error(`  Tools registered: ${registry.size}`);
    console.error(`  Categories: ${registry.getCategories().join(', ')}`);
  }

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
