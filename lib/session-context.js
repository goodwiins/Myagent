/**
 * GoodFlows Session Context Manager
 *
 * Manages context propagation through multi-agent workflows.
 * Enables agents to share state, track progress, and recover from failures.
 *
 * @module goodflows/lib/session-context
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

/**
 * Session states
 */
export const SESSION_STATES = {
  CREATED: 'created',
  RUNNING: 'running',
  PAUSED: 'paused',
  COMPLETED: 'completed',
  FAILED: 'failed',
};

/**
 * SessionContextManager - Manages context propagation across agents
 *
 * ## How It Works
 *
 * The Session Context Manager solves the problem of agents losing context
 * when they call each other. Without it:
 *
 *   Orchestrator → issue-creator → auto-fixer
 *        ↓              ↓              ↓
 *   (has context)  (no context)   (no context)
 *
 * With the Session Context Manager:
 *
 *   Orchestrator → issue-creator → auto-fixer
 *        ↓              ↓              ↓
 *   (creates)      (reads/writes)  (reads/writes)
 *        └──────── shared context ────────┘
 *
 * ## Key Concepts
 *
 * 1. **Session** - A workflow execution from start to finish
 *    - Has a unique ID (e.g., session_1704067200000_abc123)
 *    - Contains metadata about the trigger, user, timestamps
 *    - Persists to disk for recovery
 *
 * 2. **Context** - Shared state that agents read/write
 *    - Organized by namespace (findings, issues, fixes, errors)
 *    - Supports nested paths (e.g., "findings.security")
 *    - Automatically tracks who wrote what and when
 *
 * 3. **Checkpoints** - Snapshots for recovery
 *    - Saved before risky operations
 *    - Allow rollback if something fails
 *
 * 4. **Events** - Timeline of what happened
 *    - Agent invocations, completions, errors
 *    - Useful for debugging and auditing
 *
 * ## Usage Example
 *
 * ```javascript
 * // Orchestrator creates session
 * const session = new SessionContextManager();
 * session.start({ trigger: 'code-review', branch: 'feature-x' });
 *
 * // Write findings to context
 * session.set('findings.all', parsedFindings);
 * session.set('findings.critical', criticalFindings);
 *
 * // Pass sessionId to issue-creator
 * const invocation = { sessionId: session.getId(), ... };
 *
 * // --- In issue-creator ---
 * // Resume session by ID
 * const session = SessionContextManager.resume(sessionId);
 *
 * // Read findings from context
 * const findings = session.get('findings.all');
 *
 * // Write created issues back
 * session.set('issues.created', ['GOO-31', 'GOO-32']);
 * session.addEvent('issues_created', { count: 2 });
 *
 * // --- Back in orchestrator ---
 * // Read what issue-creator wrote
 * const createdIssues = session.get('issues.created');
 * ```
 */
export class SessionContextManager {
  constructor(options = {}) {
    this.basePath = options.basePath || '.goodflows/context/sessions';
    this.session = null;
    this.autoSave = options.autoSave !== false;
    this.saveInterval = options.saveInterval || 5000; // 5 seconds
    this._saveTimer = null;
  }

  /**
   * Generate a unique session ID
   */
  _generateId() {
    const timestamp = Date.now();
    const random = createHash('sha256')
      .update(Math.random().toString() + timestamp)
      .digest('hex')
      .slice(0, 8);
    return `session_${timestamp}_${random}`;
  }

  /**
   * Get the file path for a session
   */
  _getSessionPath(sessionId) {
    return join(this.basePath, `${sessionId}.json`);
  }

  /**
   * Ensure the sessions directory exists
   */
  _ensureDir() {
    if (!existsSync(this.basePath)) {
      mkdirSync(this.basePath, { recursive: true });
    }
  }

  /**
   * Start a new session
   *
   * @param {object} metadata - Session metadata
   * @param {string} metadata.trigger - What started this session (e.g., 'code-review', 'fix-issue')
   * @param {string} [metadata.branch] - Git branch being worked on
   * @param {string} [metadata.user] - User who initiated
   * @param {object} [metadata.config] - Configuration for this session
   * @returns {string} Session ID
   */
  start(metadata = {}) {
    this._ensureDir();

    const sessionId = this._generateId();
    this.session = {
      id: sessionId,
      state: SESSION_STATES.CREATED,
      metadata: {
        trigger: metadata.trigger || 'unknown',
        branch: metadata.branch || null,
        user: metadata.user || null,
        config: metadata.config || {},
        ...metadata,
      },
      timestamps: {
        created: new Date().toISOString(),
        started: null,
        updated: new Date().toISOString(),
        completed: null,
      },
      // Shared context that agents read/write
      context: {
        findings: {},
        issues: {},
        fixes: {},
        errors: [],
        custom: {},
      },
      // Invocation chain
      invocations: [],
      // Timeline of events
      events: [],
      // Checkpoints for recovery
      checkpoints: [],
      // Summary statistics
      stats: {
        agentsInvoked: 0,
        findingsProcessed: 0,
        issuesCreated: 0,
        fixesApplied: 0,
        errorsEncountered: 0,
      },
    };

    this._save();
    this._startAutoSave();

    return sessionId;
  }

  /**
   * Resume an existing session
   *
   * @param {string} sessionId - Session ID to resume
   * @param {object} options - Options
   * @returns {SessionContextManager} This instance
   */
  static resume(sessionId, options = {}) {
    const manager = new SessionContextManager(options);
    const sessionPath = manager._getSessionPath(sessionId);

    if (!existsSync(sessionPath)) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    manager.session = JSON.parse(readFileSync(sessionPath, 'utf-8'));
    manager.session.timestamps.updated = new Date().toISOString();

    if (manager.session.state === SESSION_STATES.PAUSED) {
      manager.session.state = SESSION_STATES.RUNNING;
    }

    manager._startAutoSave();
    return manager;
  }

  /**
   * Get the current session ID
   */
  getId() {
    return this.session?.id || null;
  }

  /**
   * Get the current session state
   */
  getState() {
    return this.session?.state || null;
  }

  /**
   * Mark session as running (first agent started work)
   */
  markRunning() {
    if (this.session) {
      this.session.state = SESSION_STATES.RUNNING;
      this.session.timestamps.started = new Date().toISOString();
      this._save();
    }
  }

  /**
   * Pause the session (can be resumed later)
   */
  pause() {
    if (this.session) {
      this.session.state = SESSION_STATES.PAUSED;
      this._save();
      this._stopAutoSave();
    }
  }

  /**
   * Complete the session successfully
   */
  complete(summary = {}) {
    if (this.session) {
      this.session.state = SESSION_STATES.COMPLETED;
      this.session.timestamps.completed = new Date().toISOString();
      this.session.summary = summary;
      this._save();
      this._stopAutoSave();
    }
  }

  /**
   * Mark session as failed
   */
  fail(error) {
    if (this.session) {
      this.session.state = SESSION_STATES.FAILED;
      this.session.timestamps.completed = new Date().toISOString();
      this.session.failureReason = error instanceof Error ? error.message : error;
      this.addEvent('session_failed', { error: this.session.failureReason });
      this._save();
      this._stopAutoSave();
    }
  }

  // ─────────────────────────────────────────────────────────────
  // Context Operations (Read/Write shared state)
  // ─────────────────────────────────────────────────────────────

  /**
   * Set a value in the context
   *
   * Supports dot notation for nested paths:
   * - set('findings.critical', [...])
   * - set('issues.created', ['GOO-31'])
   *
   * @param {string} path - Dot-notation path (e.g., 'findings.security')
   * @param {any} value - Value to set
   * @param {object} meta - Optional metadata (who set it, why)
   */
  set(path, value, meta = {}) {
    if (!this.session) return;

    const parts = path.split('.');
    let current = this.session.context;

    // Navigate to parent
    for (let i = 0; i < parts.length - 1; i++) {
      const part = parts[i];
      if (!(part in current)) {
        current[part] = {};
      }
      current = current[part];
    }

    // Set the value
    const lastPart = parts[parts.length - 1];
    current[lastPart] = value;

    // Track the write
    this.addEvent('context_set', {
      path,
      valueType: Array.isArray(value) ? `array[${value.length}]` : typeof value,
      agent: meta.agent || 'unknown',
    });

    this.session.timestamps.updated = new Date().toISOString();

    if (this.autoSave) {
      this._debouncedSave();
    }
  }

  /**
   * Get a value from the context
   *
   * @param {string} path - Dot-notation path
   * @param {any} defaultValue - Default if not found
   * @returns {any} The value or default
   */
  get(path, defaultValue = undefined) {
    if (!this.session) return defaultValue;

    const parts = path.split('.');
    let current = this.session.context;

    for (const part of parts) {
      if (current === undefined || current === null || !(part in current)) {
        return defaultValue;
      }
      current = current[part];
    }

    return current;
  }

  /**
   * Check if a path exists in context
   */
  has(path) {
    return this.get(path) !== undefined;
  }

  /**
   * Append to an array in context
   */
  append(path, value) {
    const current = this.get(path, []);
    if (!Array.isArray(current)) {
      throw new Error(`Cannot append to non-array at path: ${path}`);
    }
    this.set(path, [...current, value]);
  }

  /**
   * Merge an object into context
   */
  merge(path, obj) {
    const current = this.get(path, {});
    if (typeof current !== 'object' || Array.isArray(current)) {
      throw new Error(`Cannot merge into non-object at path: ${path}`);
    }
    this.set(path, { ...current, ...obj });
  }

  /**
   * Get the entire context object
   */
  getContext() {
    return this.session?.context || {};
  }

  // ─────────────────────────────────────────────────────────────
  // Invocation Tracking
  // ─────────────────────────────────────────────────────────────

  /**
   * Record an agent invocation
   *
   * @param {string} agentName - Name of agent being invoked
   * @param {object} input - Input being passed
   * @param {string} parentAgent - Agent making the call
   * @returns {string} Invocation ID
   */
  recordInvocation(agentName, input, parentAgent = null) {
    if (!this.session) return null;

    const invocationId = `inv_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    const invocation = {
      id: invocationId,
      agent: agentName,
      parent: parentAgent,
      input: this._sanitizeForLog(input),
      startedAt: new Date().toISOString(),
      completedAt: null,
      status: 'running',
      result: null,
    };

    this.session.invocations.push(invocation);
    this.session.stats.agentsInvoked++;

    this.addEvent('agent_invoked', { agent: agentName, invocationId });

    return invocationId;
  }

  /**
   * Record invocation result
   */
  recordInvocationResult(invocationId, result, status = 'success') {
    if (!this.session) return;

    const invocation = this.session.invocations.find((i) => i.id === invocationId);
    if (invocation) {
      invocation.completedAt = new Date().toISOString();
      invocation.status = status;
      invocation.result = this._sanitizeForLog(result);

      this.addEvent('agent_completed', {
        agent: invocation.agent,
        invocationId,
        status,
      });
    }
  }

  /**
   * Get invocation chain (call stack)
   */
  getInvocationChain() {
    return this.session?.invocations || [];
  }

  // ─────────────────────────────────────────────────────────────
  // Event Timeline
  // ─────────────────────────────────────────────────────────────

  /**
   * Add an event to the timeline
   *
   * @param {string} type - Event type (e.g., 'issues_created', 'fix_applied')
   * @param {object} data - Event data
   */
  addEvent(type, data = {}) {
    if (!this.session) return;

    this.session.events.push({
      type,
      data,
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * Get events by type
   */
  getEvents(type = null) {
    if (!this.session) return [];

    if (type) {
      return this.session.events.filter((e) => e.type === type);
    }
    return this.session.events;
  }

  // ─────────────────────────────────────────────────────────────
  // Checkpoints (for recovery)
  // ─────────────────────────────────────────────────────────────

  /**
   * Create a checkpoint (snapshot of current state)
   *
   * Use before risky operations so you can rollback if needed.
   *
   * @param {string} label - Checkpoint label (e.g., 'before_fix_apply')
   * @returns {string} Checkpoint ID
   */
  checkpoint(label) {
    if (!this.session) return null;

    const checkpointId = `chk_${Date.now()}`;

    this.session.checkpoints.push({
      id: checkpointId,
      label,
      timestamp: new Date().toISOString(),
      context: JSON.parse(JSON.stringify(this.session.context)),
      stats: { ...this.session.stats },
    });

    this.addEvent('checkpoint_created', { checkpointId, label });
    this._save();

    return checkpointId;
  }

  /**
   * Rollback to a checkpoint
   *
   * @param {string} checkpointId - Checkpoint to rollback to
   */
  rollback(checkpointId) {
    if (!this.session) return false;

    const checkpoint = this.session.checkpoints.find((c) => c.id === checkpointId);
    if (!checkpoint) {
      throw new Error(`Checkpoint not found: ${checkpointId}`);
    }

    // Restore context and stats
    this.session.context = JSON.parse(JSON.stringify(checkpoint.context));
    this.session.stats = { ...checkpoint.stats };

    this.addEvent('rollback', { checkpointId, label: checkpoint.label });
    this._save();

    return true;
  }

  /**
   * Get available checkpoints
   */
  getCheckpoints() {
    return this.session?.checkpoints || [];
  }

  // ─────────────────────────────────────────────────────────────
  // Statistics
  // ─────────────────────────────────────────────────────────────

  /**
   * Increment a stat counter
   */
  incrementStat(stat, amount = 1) {
    if (this.session && stat in this.session.stats) {
      this.session.stats[stat] += amount;
    }
  }

  /**
   * Get current stats
   */
  getStats() {
    return this.session?.stats || {};
  }

  // ─────────────────────────────────────────────────────────────
  // Error Tracking
  // ─────────────────────────────────────────────────────────────

  /**
   * Record an error
   */
  recordError(error, context = {}) {
    if (!this.session) return;

    const errorRecord = {
      message: error instanceof Error ? error.message : error,
      stack: error instanceof Error ? error.stack : null,
      context,
      timestamp: new Date().toISOString(),
    };

    this.session.context.errors.push(errorRecord);
    this.session.stats.errorsEncountered++;

    this.addEvent('error', { message: errorRecord.message });
  }

  /**
   * Get all recorded errors
   */
  getErrors() {
    return this.session?.context?.errors || [];
  }

  // ─────────────────────────────────────────────────────────────
  // Persistence
  // ─────────────────────────────────────────────────────────────

  /**
   * Save session to disk
   */
  _save() {
    if (!this.session) return;

    this._ensureDir();
    const path = this._getSessionPath(this.session.id);
    writeFileSync(path, JSON.stringify(this.session, null, 2));
  }

  /**
   * Debounced save (avoid too frequent writes)
   */
  _debouncedSave() {
    if (this._saveDebounce) {
      clearTimeout(this._saveDebounce);
    }
    this._saveDebounce = setTimeout(() => this._save(), 100);
  }

  /**
   * Start auto-save timer
   */
  _startAutoSave() {
    if (this.autoSave && !this._saveTimer) {
      this._saveTimer = setInterval(() => this._save(), this.saveInterval);
    }
  }

  /**
   * Stop auto-save timer
   */
  _stopAutoSave() {
    if (this._saveTimer) {
      clearInterval(this._saveTimer);
      this._saveTimer = null;
    }
    this._save(); // Final save
  }

  /**
   * Sanitize data for logging (remove large objects, sensitive data)
   */
  _sanitizeForLog(data) {
    if (!data) return data;

    const sanitized = { ...data };

    // Remove potentially large arrays, just keep length
    for (const [key, value] of Object.entries(sanitized)) {
      if (Array.isArray(value) && value.length > 10) {
        sanitized[key] = `[Array: ${value.length} items]`;
      } else if (typeof value === 'string' && value.length > 500) {
        sanitized[key] = value.slice(0, 500) + '...';
      }
    }

    return sanitized;
  }

  /**
   * Get session summary for reporting
   */
  getSummary() {
    if (!this.session) return null;

    return {
      id: this.session.id,
      state: this.session.state,
      trigger: this.session.metadata.trigger,
      duration: this._calculateDuration(),
      stats: this.session.stats,
      agentChain: this.session.invocations.map((i) => ({
        agent: i.agent,
        status: i.status,
      })),
      errorCount: this.session.context.errors.length,
    };
  }

  /**
   * Calculate session duration
   */
  _calculateDuration() {
    if (!this.session) return null;

    const start = new Date(this.session.timestamps.created);
    const end = this.session.timestamps.completed
      ? new Date(this.session.timestamps.completed)
      : new Date();

    return Math.round((end - start) / 1000); // seconds
  }
}

/**
 * Create a new session context manager
 */
export function createSessionContext(options = {}) {
  return new SessionContextManager(options);
}

export default {
  SessionContextManager,
  createSessionContext,
  SESSION_STATES,
};
