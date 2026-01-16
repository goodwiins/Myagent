/**
 * GoodFlows MCP Session Handlers
 *
 * Handles session lifecycle: start, resume, context read/write, checkpoint, rollback, end
 *
 * @module goodflows/bin/mcp/handlers/session
 */

import { SessionContextManager } from '../../../lib/session-context.js';
import { mcpResponse, mcpError } from '../tool-registry.js';

/**
 * Session Tool Definitions
 */
export const tools = [
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
];

/**
 * Session Handlers
 */
export const handlers = {
  async goodflows_session_start(args, services) {
    const { activeSessions, getProjectContext } = services;

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

    return mcpResponse({
      sessionId,
      status: 'started',
      project: projectContext.project.name,
      github: projectContext.github.url,
      branch: projectContext.github.branch,
    });
  },

  async goodflows_session_resume(args, services) {
    const { activeSessions } = services;

    let session = activeSessions.get(args.sessionId);
    if (!session) {
      session = SessionContextManager.resume(args.sessionId);
      if (session) {
        activeSessions.set(args.sessionId, session);
      }
    }
    if (!session) {
      return mcpError('Session not found', 'SESSION_NOT_FOUND');
    }
    return mcpResponse({
      sessionId: args.sessionId,
      status: 'resumed',
      context: session.getContext(),
    });
  },

  async goodflows_session_get_context(args, services) {
    const { activeSessions } = services;

    const session = activeSessions.get(args.sessionId);
    if (!session) {
      return mcpError('Session not found', 'SESSION_NOT_FOUND');
    }
    const value = session.get(args.path);
    return mcpResponse({ path: args.path, value });
  },

  async goodflows_session_set_context(args, services) {
    const { activeSessions } = services;

    const session = activeSessions.get(args.sessionId);
    if (!session) {
      return mcpError('Session not found', 'SESSION_NOT_FOUND');
    }
    session.set(args.path, args.value);
    return mcpResponse({ success: true, path: args.path });
  },

  async goodflows_session_checkpoint(args, services) {
    const { activeSessions } = services;

    const session = activeSessions.get(args.sessionId);
    if (!session) {
      return mcpError('Session not found', 'SESSION_NOT_FOUND');
    }
    const checkpointId = session.checkpoint(args.name);
    return mcpResponse({ checkpointId, name: args.name });
  },

  async goodflows_session_rollback(args, services) {
    const { activeSessions } = services;

    const session = activeSessions.get(args.sessionId);
    if (!session) {
      return mcpError('Session not found', 'SESSION_NOT_FOUND');
    }
    session.rollback(args.checkpointId);
    return mcpResponse({ success: true, rolledBackTo: args.checkpointId });
  },

  async goodflows_session_end(args, services) {
    const { activeSessions } = services;

    const session = activeSessions.get(args.sessionId);
    if (!session) {
      return mcpError('Session not found', 'SESSION_NOT_FOUND');
    }
    session.complete(args.summary || {});
    const finalSummary = session.session?.summary || {};
    activeSessions.delete(args.sessionId);

    return mcpResponse({
      success: true,
      status: args.status || 'completed',
      summary: finalSummary,
      hasConflicts: finalSummary._hasConflicts || false,
      derived: finalSummary._derived || {},
    });
  },
};

export default { tools, handlers };
