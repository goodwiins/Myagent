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
    name: 'goodflows_session_context',
    description: `Get or set session context values. Supports dot notation paths.

Actions:
- "get": Get value from session context (default)
- "set": Set value in session context

Examples:
- Get: { "action": "get", "sessionId": "...", "path": "findings.all" }
- Set: { "action": "set", "sessionId": "...", "path": "custom.data", "value": {...} }`,
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['get', 'set'], description: 'Operation (default: get)' },
        sessionId: { type: 'string' },
        path: { type: 'string', description: 'Context path (e.g., findings.all, issues.created)' },
        value: { description: 'Value to store (for set, any JSON type)' },
      },
      required: ['sessionId', 'path'],
    },
  },
  {
    name: 'goodflows_session_checkpoint',
    description: `Create or rollback to a checkpoint.

Actions:
- "create": Create a checkpoint for potential rollback (default)
- "rollback": Rollback session to a checkpoint

Examples:
- Create: { "sessionId": "...", "name": "before_fixes" }
- Rollback: { "action": "rollback", "sessionId": "...", "checkpointId": "..." }`,
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['create', 'rollback'], description: 'Operation (default: create)' },
        sessionId: { type: 'string' },
        name: { type: 'string', description: 'Checkpoint name (for create)' },
        checkpointId: { type: 'string', description: 'Checkpoint ID (for rollback)' },
      },
      required: ['sessionId'],
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

  async goodflows_session_context(args, services) {
    const { activeSessions } = services;
    const action = args.action || 'get';

    const session = activeSessions.get(args.sessionId);
    if (!session) {
      return mcpError('Session not found', 'SESSION_NOT_FOUND');
    }

    if (action === 'get') {
      const value = session.get(args.path);
      return mcpResponse({ path: args.path, value });
    } else if (action === 'set') {
      if (args.value === undefined) {
        return mcpError('value is required for action=set', 'INVALID_ARGS');
      }
      session.set(args.path, args.value);
      return mcpResponse({ success: true, path: args.path });
    } else {
      return mcpError(`Unknown action: ${action}. Valid: get, set`, 'INVALID_ACTION');
    }
  },

  async goodflows_session_checkpoint(args, services) {
    const { activeSessions } = services;
    const action = args.action || 'create';

    const session = activeSessions.get(args.sessionId);
    if (!session) {
      return mcpError('Session not found', 'SESSION_NOT_FOUND');
    }

    if (action === 'create') {
      if (!args.name) {
        return mcpError('name is required for action=create', 'INVALID_ARGS');
      }
      const checkpointId = session.checkpoint(args.name);
      return mcpResponse({ checkpointId, name: args.name });
    } else if (action === 'rollback') {
      if (!args.checkpointId) {
        return mcpError('checkpointId is required for action=rollback', 'INVALID_ARGS');
      }
      session.rollback(args.checkpointId);
      return mcpResponse({ success: true, rolledBackTo: args.checkpointId });
    } else {
      return mcpError(`Unknown action: ${action}. Valid: create, rollback`, 'INVALID_ACTION');
    }
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
