/**
 * GoodFlows Session Context Manager
 *
 * Manages context propagation through multi-agent workflows.
 * Enables agents to share state, track progress, and recover from failures.
 *
 * @module goodflows/lib/session-context
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, relative, isAbsolute } from 'node:path';
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
    this._saveDebounce = null;
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
      // Easy tracking data (auto-populated by helper methods)
      tracking: {
        files: {
          created: [],   // { path, timestamp, workId? }
          modified: [],  // { path, timestamp, workId? }
          deleted: [],   // { path, timestamp, workId? }
        },
        issues: {
          created: [],   // { id, title?, timestamp, workId? }
          fixed: [],     // { id, timestamp, workId? }
          skipped: [],   // { id, reason?, timestamp, workId? }
          failed: [],    // { id, error?, timestamp, workId? }
        },
        findings: [],    // { type, file, description, timestamp, workId? }
        work: [],        // Completed work units
        currentWork: null, // Active work unit
        // Plan execution tracking
        plans: {
          active: null,    // Currently executing plan ID
          completed: [],   // Completed plan IDs
          history: [],     // { planId, status, subtaskCount, completedAt }
        },
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
   *
   * Summary is auto-derived from tracked stats and context.
   * Any provided summary values are merged, with warnings if they conflict.
   *
   * @param {object} summary - Optional summary overrides (merged with derived)
   */
  complete(summary = {}) {
    if (this.session) {
      this.session.state = SESSION_STATES.COMPLETED;
      this.session.timestamps.completed = new Date().toISOString();

      // Auto-derive summary from actual tracked data
      const derived = this._deriveSummary();

      // Check for conflicts between provided and derived values
      const conflicts = this._checkSummaryConflicts(derived, summary);
      if (conflicts.length > 0) {
        this.addEvent('summary_conflicts', {
          conflicts,
          message: 'Provided summary values differ from tracked stats',
        });
      }

      // Merge: derived values as base, provided values override
      this.session.summary = {
        ...derived,
        ...summary,
        _derived: derived, // Keep original derived for audit
        _hasConflicts: conflicts.length > 0,
      };

      this._save();
      this._stopAutoSave();
    }
  }

  /**
   * Derive summary from actual tracked stats and context
   * @private
   */
  _deriveSummary() {
    if (!this.session) return {};

    const ctx = this.session.context;
    const stats = this.session.stats;
    const tracking = this.session.tracking;

    // Prefer tracking data, fall back to context, then stats
    let issuesCreated = 0;
    let issuesFixed = 0;
    let issuesSkipped = 0;
    let issuesFailed = 0;
    let filesCreated = 0;
    let filesModifiedCount = 0;
    let findingsCount = 0;

    // Use tracking data if available (new method)
    if (tracking) {
      issuesCreated = tracking.issues?.created?.length || 0;
      issuesFixed = tracking.issues?.fixed?.length || 0;
      issuesSkipped = tracking.issues?.skipped?.length || 0;
      issuesFailed = tracking.issues?.failed?.length || 0;
      filesCreated = tracking.files?.created?.length || 0;
      filesModifiedCount = tracking.files?.modified?.length || 0;
      findingsCount = tracking.findings?.length || 0;
    }

    // Fall back to context if tracking is empty (old method)
    if (issuesCreated === 0) {
      issuesCreated = ctx.issues?.created
        ? (Array.isArray(ctx.issues.created) ? ctx.issues.created.length : Object.keys(ctx.issues.created).length)
        : 0;
    }

    if (issuesFixed === 0) {
      const fixesApplied = ctx.fixes?.applied
        ? (Array.isArray(ctx.fixes.applied) ? ctx.fixes.applied.length : Object.keys(ctx.fixes.applied).length)
        : 0;
      issuesFixed = fixesApplied;
    }

    if (issuesFailed === 0) {
      issuesFailed = ctx.fixes?.failed
        ? (Array.isArray(ctx.fixes.failed) ? ctx.fixes.failed.length : Object.keys(ctx.fixes.failed).length)
        : 0;
    }

    if (findingsCount === 0) {
      findingsCount = ctx.findings?.all
        ? (Array.isArray(ctx.findings.all) ? ctx.findings.all.length : Object.keys(ctx.findings.all).length)
        : 0;
    }

    // Count unique files from tracking or context
    const filesSet = new Set();
    if (tracking?.files) {
      tracking.files.created?.forEach(f => filesSet.add(f.path));
      tracking.files.modified?.forEach(f => filesSet.add(f.path));
    }
    if (filesSet.size === 0 && ctx.fixes?.applied && Array.isArray(ctx.fixes.applied)) {
      ctx.fixes.applied.forEach(fix => {
        if (fix?.file) filesSet.add(fix.file);
      });
    }

    // Final fallback to stats
    const totalIssues = issuesCreated || stats.issuesCreated;
    const fixed = issuesFixed || stats.fixesApplied;

    return {
      totalIssues,
      issuesCreated: issuesCreated || stats.issuesCreated,
      fixed,
      failed: issuesFailed,
      skipped: issuesSkipped || Math.max(0, totalIssues - fixed - issuesFailed),
      filesCreated,
      filesModified: filesModifiedCount || filesSet.size,
      filesTotal: filesSet.size,
      findingsProcessed: findingsCount || stats.findingsProcessed,
      errorsEncountered: ctx.errors?.length || stats.errorsEncountered,
      agentsInvoked: stats.agentsInvoked,
      duration: this._calculateDuration(),
    };
  }

  /**
   * Check for conflicts between derived and provided summary values
   * @private
   */
  _checkSummaryConflicts(derived, provided) {
    const conflicts = [];
    const keysToCheck = ['totalIssues', 'issuesCreated', 'fixed', 'skipped', 'filesModified'];

    for (const key of keysToCheck) {
      if (key in provided && key in derived && provided[key] !== derived[key]) {
        // Only flag as conflict if derived value is non-zero (we actually tracked something)
        if (derived[key] > 0) {
          conflicts.push({
            key,
            provided: provided[key],
            derived: derived[key],
          });
        }
      }
    }

    return conflicts;
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
  // Easy Tracking Helpers
  // ─────────────────────────────────────────────────────────────
  //
  // These methods make it easy to track work during a session.
  // They automatically update both the tracking data and stats.
  //
  // Usage:
  //   session.trackFile('src/api/auth.ts', 'created');
  //   session.trackIssue('GOO-53', 'fixed');
  //   session.trackFinding({ type: 'security', file: 'auth.ts', description: '...' });
  //
  // Or with work units:
  //   session.startWork('fix-issue', { issueId: 'GOO-53' });
  //   session.trackFile('src/auth.ts', 'modified');
  //   session.completeWork({ success: true });

  /**
   * Ensure tracking structure exists (for resumed sessions from older versions)
   * @private
   */
  _ensureTracking() {
    if (!this.session) return;
    if (!this.session.tracking) {
      this.session.tracking = {
        files: { created: [], modified: [], deleted: [] },
        issues: { created: [], fixed: [], skipped: [], failed: [] },
        findings: [],
        work: [],
        currentWork: null,
        plans: { active: null, completed: [], history: [] },
      };
    }
    // Ensure plans namespace exists for older sessions
    if (!this.session.tracking.plans) {
      this.session.tracking.plans = { active: null, completed: [], history: [] };
    }
  }

  /**
   * Track a file operation
   *
   * @param {string} filePath - Path to the file
   * @param {string} action - 'created' | 'modified' | 'deleted'
   * @param {object} meta - Optional metadata
   * @returns {this} For chaining
   *
   * @example
   * session.trackFile('src/api/auth.ts', 'created');
   * session.trackFile('src/utils/helpers.ts', 'modified', { reason: 'refactor' });
   */
  trackFile(filePath, action = 'modified', meta = {}) {
    if (!this.session) return this;
    this._ensureTracking();

    const validActions = ['created', 'modified', 'deleted'];
    if (!validActions.includes(action)) {
      action = 'modified';
    }

    // Normalize path to relative
    if (filePath && isAbsolute(filePath)) {
      filePath = relative(process.cwd(), filePath);
    }

    const entry = {
      path: filePath,
      timestamp: new Date().toISOString(),
      ...meta,
    };

    // Add work ID if in a work unit
    if (this.session.tracking.currentWork) {
      entry.workId = this.session.tracking.currentWork.id;
    }

    // Check if already tracked (dedupe by path within same action)
    const existing = this.session.tracking.files[action].find(f => f.path === filePath);
    if (!existing) {
      this.session.tracking.files[action].push(entry);

      // Update stats
      if (action === 'created' || action === 'modified') {
        this.incrementStat('fixesApplied', 1);
      }

      // Also update context for backwards compatibility
      this.append(`fixes.${action}`, { file: filePath, timestamp: entry.timestamp });

      this.addEvent('file_tracked', { path: filePath, action });
    }

    if (this.autoSave) this._debouncedSave();
    return this;
  }

  /**
   * Track multiple files at once
   *
   * @param {string[]} filePaths - Array of file paths
   * @param {string} action - 'created' | 'modified' | 'deleted'
   * @param {object} meta - Optional metadata applied to all
   * @returns {this} For chaining
   *
   * @example
   * session.trackFiles(['src/a.ts', 'src/b.ts', 'src/c.ts'], 'created');
   */
  trackFiles(filePaths, action = 'modified', meta = {}) {
    for (const filePath of filePaths) {
      this.trackFile(filePath, action, meta);
    }
    return this;
  }

  /**
   * Track an issue operation
   *
   * @param {string} issueId - Issue ID (e.g., 'GOO-53')
   * @param {string} action - 'created' | 'fixed' | 'skipped' | 'failed'
   * @param {object} meta - Optional metadata (title, reason, error)
   * @returns {this} For chaining
   *
   * @example
   * session.trackIssue('GOO-53', 'created', { title: 'Fix auth bug' });
   * session.trackIssue('GOO-53', 'fixed');
   * session.trackIssue('GOO-54', 'skipped', { reason: 'duplicate' });
   */
  trackIssue(issueId, action = 'created', meta = {}) {
    if (!this.session) return this;
    this._ensureTracking();

    const validActions = ['created', 'fixed', 'skipped', 'failed'];
    if (!validActions.includes(action)) {
      action = 'created';
    }

    const entry = {
      id: issueId,
      timestamp: new Date().toISOString(),
      ...meta,
    };

    // Add work ID if in a work unit
    if (this.session.tracking.currentWork) {
      entry.workId = this.session.tracking.currentWork.id;
    }

    // Check if already tracked (dedupe by id within same action)
    const existing = this.session.tracking.issues[action].find(i => i.id === issueId);
    if (!existing) {
      this.session.tracking.issues[action].push(entry);

      // Update stats
      if (action === 'created') {
        this.incrementStat('issuesCreated', 1);
      } else if (action === 'fixed') {
        this.incrementStat('fixesApplied', 1);
      }

      // Also update context for backwards compatibility
      this.append(`issues.${action}`, issueId);

      this.addEvent('issue_tracked', { id: issueId, action });
    }

    if (this.autoSave) this._debouncedSave();
    return this;
  }

  /**
   * Track multiple issues at once
   *
   * @param {string[]} issueIds - Array of issue IDs
   * @param {string} action - 'created' | 'fixed' | 'skipped' | 'failed'
   * @param {object} meta - Optional metadata applied to all
   * @returns {this} For chaining
   */
  trackIssues(issueIds, action = 'created', meta = {}) {
    for (const issueId of issueIds) {
      this.trackIssue(issueId, action, meta);
    }
    return this;
  }

  /**
   * Track a finding
   *
   * @param {object} finding - Finding object
   * @param {string} finding.type - Finding type (e.g., 'security', 'bug', 'refactor')
   * @param {string} finding.file - File path
   * @param {string} finding.description - Description
   * @returns {this} For chaining
   *
   * @example
   * session.trackFinding({
   *   type: 'security',
   *   file: 'src/auth.ts',
   *   description: 'Exposed API key',
   *   severity: 'critical'
   * });
   */
  trackFinding(finding) {
    if (!this.session) return this;
    this._ensureTracking();

    const entry = {
      ...finding,
      timestamp: new Date().toISOString(),
    };

    // Normalize path to relative
    if (entry.file && isAbsolute(entry.file)) {
      entry.file = relative(process.cwd(), entry.file);
    }

    // Add work ID if in a work unit
    if (this.session.tracking.currentWork) {
      entry.workId = this.session.tracking.currentWork.id;
    }

    this.session.tracking.findings.push(entry);
    this.incrementStat('findingsProcessed', 1);

    // Also update context
    this.append('findings.all', finding);

    this.addEvent('finding_tracked', {
      type: finding.type,
      file: finding.file,
    });

    if (this.autoSave) this._debouncedSave();
    return this;
  }

  /**
   * Track multiple findings at once
   *
   * @param {object[]} findings - Array of finding objects
   * @returns {this} For chaining
   */
  trackFindings(findings) {
    for (const finding of findings) {
      this.trackFinding(finding);
    }
    return this;
  }

  /**
   * Start a unit of work
   *
   * Work units group related tracking together. Use this when implementing
   * a feature, fixing an issue, or doing a code review.
   *
   * @param {string} type - Work type (e.g., 'fix-issue', 'implement-feature', 'code-review')
   * @param {object} meta - Work metadata (issueId, title, description, etc.)
   * @returns {this} For chaining
   *
   * @example
   * session.startWork('fix-issue', {
   *   issueId: 'GOO-53',
   *   title: 'Thread Export Feature',
   *   description: 'Implement export functionality'
   * });
   *
   * // Track files and issues (automatically linked to this work unit)
   * session.trackFile('src/export.ts', 'created');
   * session.trackFile('src/formats/md.ts', 'created');
   *
   * session.completeWork({ success: true, endpoints: 5 });
   */
  startWork(type, meta = {}) {
    if (!this.session) return this;
    this._ensureTracking();

    const workId = `work_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

    this.session.tracking.currentWork = {
      id: workId,
      type,
      metadata: meta,
      startedAt: new Date().toISOString(),
    };

    this.addEvent('work_started', { workId, type, ...meta });

    if (this.autoSave) this._debouncedSave();
    return this;
  }

  /**
   * Complete the current unit of work
   *
   * Calculates totals from tracked items and stores a work summary.
   *
   * @param {object} result - Result data to merge into work summary
   * @returns {object} Work summary with calculated totals
   *
   * @example
   * const summary = session.completeWork({
   *   success: true,
   *   endpoints: 5,
   *   formats: ['md', 'html', 'json']
   * });
   * // summary = { workId, type, duration, filesCreated: 2, ..., endpoints: 5, ... }
   */
  completeWork(result = {}) {
    if (!this.session) return null;
    this._ensureTracking();

    const currentWork = this.session.tracking.currentWork;
    if (!currentWork) {
      // No active work, create ad-hoc summary
      return this._calculateWorkSummary(null, result);
    }

    const workId = currentWork.id;
    const completedAt = new Date().toISOString();
    const duration = Math.round(
      (new Date(completedAt) - new Date(currentWork.startedAt)) / 1000,
    );

    // Calculate totals from items tracked under this work ID
    const summary = this._calculateWorkSummary(workId, {
      ...currentWork.metadata,
      ...result,
      duration,
    });

    // Store completed work
    this.session.tracking.work.push({
      id: workId,
      type: currentWork.type,
      metadata: currentWork.metadata,
      startedAt: currentWork.startedAt,
      completedAt,
      summary,
    });

    // Clear current work
    this.session.tracking.currentWork = null;

    this.addEvent('work_completed', { workId, type: currentWork.type, summary });

    if (this.autoSave) this._debouncedSave();
    return summary;
  }

  /**
   * Calculate work summary from tracked items
   * @private
   */
  _calculateWorkSummary(workId, additionalData = {}) {
    if (!this.session?.tracking) return additionalData;

    const t = this.session.tracking;

    // Count files by action (optionally filtered by workId)
    const countFiles = (action) => {
      if (workId) {
        return t.files[action].filter(f => f.workId === workId).length;
      }
      return t.files[action].length;
    };

    // Count issues by action (optionally filtered by workId)
    const countIssues = (action) => {
      if (workId) {
        return t.issues[action].filter(i => i.workId === workId).length;
      }
      return t.issues[action].length;
    };

    // Count findings (optionally filtered by workId)
    const countFindings = () => {
      if (workId) {
        return t.findings.filter(f => f.workId === workId).length;
      }
      return t.findings.length;
    };

    // Get unique files (created + modified)
    const getUniqueFiles = () => {
      const files = new Set();
      const filter = workId ? (f => f.workId === workId) : () => true;
      t.files.created.filter(filter).forEach(f => files.add(f.path));
      t.files.modified.filter(filter).forEach(f => files.add(f.path));
      return files.size;
    };

    return {
      filesCreated: countFiles('created'),
      filesModified: countFiles('modified'),
      filesDeleted: countFiles('deleted'),
      filesTotal: getUniqueFiles(),
      issuesCreated: countIssues('created'),
      issuesFixed: countIssues('fixed'),
      issuesSkipped: countIssues('skipped'),
      issuesFailed: countIssues('failed'),
      findingsProcessed: countFindings(),
      ...additionalData,
    };
  }

  /**
   * Get current work status
   *
   * @returns {object|null} Current work unit or null
   */
  getCurrentWork() {
    return this.session?.tracking?.currentWork || null;
  }

  /**
   * Get all completed work units
   *
   * @returns {object[]} Array of completed work summaries
   */
  getCompletedWork() {
    return this.session?.tracking?.work || [];
  }

  /**
   * Get tracking summary
   *
   * @returns {object} Summary of all tracked items
   */
  getTrackingSummary() {
    return this._calculateWorkSummary(null);
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
    if (this._saveDebounce) {
      clearTimeout(this._saveDebounce);
      this._saveDebounce = null;
    }
    this._save(); // Final save
  }

  /**
   * Destroy the session manager (clean up all resources)
   * Call this when done with the session manager to prevent memory leaks.
   */
  destroy() {
    this._stopAutoSave();
    this.session = null;
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
