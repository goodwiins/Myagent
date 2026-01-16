/**
 * Unit tests for SessionContextManager
 *
 * Coverage targets: 85%+ for functions (30 untested functions)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SessionContextManager, SESSION_STATES, createSessionContext } from '../../lib/session-context.js';
import { existsSync, rmSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { randomUUID } from 'crypto';

// Use unique test directory per test to avoid collisions
const getTestBasePath = () => `.goodflows-test-${randomUUID().slice(0, 8)}/context/sessions`;

describe('SessionContextManager', () => {
  let manager;
  let testBasePath;

  beforeEach(() => {
    testBasePath = getTestBasePath();
    // Clean up test directory if it exists
    const rootDir = testBasePath.split('/')[0];
    if (existsSync(rootDir)) {
      rmSync(rootDir, { recursive: true, force: true });
    }
    manager = new SessionContextManager({ basePath: testBasePath, autoSave: false });
  });

  afterEach(() => {
    // Clean up after tests
    if (manager) {
      manager.destroy();
    }
    const rootDir = testBasePath.split('/')[0];
    if (existsSync(rootDir)) {
      rmSync(rootDir, { recursive: true, force: true });
    }
  });

  // ─────────────────────────────────────────────────────────────
  // Session Lifecycle Tests
  // ─────────────────────────────────────────────────────────────

  describe('Session Lifecycle', () => {
    it('start() creates new session with metadata', () => {
      const sessionId = manager.start({
        trigger: 'test-trigger',
        branch: 'main',
        user: 'tester',
        config: { key: 'value' },
      });

      expect(sessionId).toMatch(/^session_\d+_[a-f0-9]+$/);
      expect(manager.getState()).toBe(SESSION_STATES.CREATED);
      expect(manager.getId()).toBe(sessionId);
      expect(manager.session.metadata.trigger).toBe('test-trigger');
      expect(manager.session.metadata.branch).toBe('main');
      expect(manager.session.metadata.user).toBe('tester');
      expect(manager.session.metadata.config).toEqual({ key: 'value' });
    });

    it('start() creates directory structure', () => {
      manager.start({ trigger: 'test' });
      expect(existsSync(testBasePath)).toBe(true);
    });

    it('start() initializes tracking structure', () => {
      manager.start({ trigger: 'test' });

      expect(manager.session.tracking).toBeDefined();
      expect(manager.session.tracking.files).toEqual({
        created: [],
        modified: [],
        deleted: [],
      });
      expect(manager.session.tracking.issues).toEqual({
        created: [],
        fixed: [],
        skipped: [],
        failed: [],
      });
      expect(manager.session.tracking.findings).toEqual([]);
      expect(manager.session.tracking.work).toEqual([]);
      expect(manager.session.tracking.currentWork).toBeNull();
    });

    it('markRunning() marks session as running', () => {
      manager.start({ trigger: 'test' });
      expect(manager.getState()).toBe(SESSION_STATES.CREATED);

      manager.markRunning();

      expect(manager.getState()).toBe(SESSION_STATES.RUNNING);
      expect(manager.session.timestamps.started).toBeDefined();
    });

    it('pause() marks session as paused', () => {
      manager.start({ trigger: 'test' });
      manager.markRunning();

      manager.pause();

      expect(manager.getState()).toBe(SESSION_STATES.PAUSED);
    });

    it('complete() finalizes session with summary', () => {
      manager.start({ trigger: 'test' });
      manager.markRunning();

      manager.complete({ totalIssues: 5, fixed: 3 });

      expect(manager.getState()).toBe(SESSION_STATES.COMPLETED);
      expect(manager.session.timestamps.completed).toBeDefined();
      expect(manager.session.summary).toBeDefined();
      expect(manager.session.summary.totalIssues).toBe(5);
      expect(manager.session.summary.fixed).toBe(3);
    });

    it('complete() auto-derives summary from tracking data', () => {
      manager.start({ trigger: 'test' });
      manager.trackFile('src/a.ts', 'created');
      manager.trackFile('src/b.ts', 'modified');
      manager.trackIssue('GOO-1', 'created');
      manager.trackIssue('GOO-2', 'fixed');

      manager.complete();

      expect(manager.session.summary._derived).toBeDefined();
      expect(manager.session.summary._derived.filesCreated).toBe(1);
      expect(manager.session.summary._derived.filesModified).toBe(1);
      expect(manager.session.summary._derived.issuesCreated).toBe(1);
    });

    it('fail() records failure reason', () => {
      manager.start({ trigger: 'test' });
      manager.markRunning();

      manager.fail(new Error('Test error'));

      expect(manager.getState()).toBe(SESSION_STATES.FAILED);
      expect(manager.session.failureReason).toBe('Test error');
      expect(manager.session.timestamps.completed).toBeDefined();
    });

    it('fail() handles string error', () => {
      manager.start({ trigger: 'test' });

      manager.fail('Something went wrong');

      expect(manager.session.failureReason).toBe('Something went wrong');
    });
  });

  describe('Session Resume', () => {
    it('resume() continues paused session', () => {
      const sessionId = manager.start({ trigger: 'test' });
      manager.set('test.value', 42);
      manager.pause();
      manager.destroy();

      const resumed = SessionContextManager.resume(sessionId, { basePath: testBasePath, autoSave: false });

      expect(resumed.getId()).toBe(sessionId);
      expect(resumed.getState()).toBe(SESSION_STATES.RUNNING);
      expect(resumed.get('test.value')).toBe(42);

      resumed.destroy();
    });

    it('resume() throws on non-existent session', () => {
      expect(() => {
        SessionContextManager.resume('session_nonexistent', { basePath: testBasePath });
      }).toThrow('Session not found');
    });
  });

  // ─────────────────────────────────────────────────────────────
  // Context Operations Tests
  // ─────────────────────────────────────────────────────────────

  describe('Context Operations', () => {
    beforeEach(() => {
      manager.start({ trigger: 'test' });
    });

    it('set() stores value at path', () => {
      manager.set('findings.critical', [{ id: 1 }]);

      expect(manager.session.context.findings.critical).toEqual([{ id: 1 }]);
    });

    it('set() creates nested paths', () => {
      manager.set('deep.nested.path', 'value');

      expect(manager.session.context.deep.nested.path).toBe('value');
    });

    it('get() retrieves value from path', () => {
      manager.set('issues.created', ['GOO-1', 'GOO-2']);

      expect(manager.get('issues.created')).toEqual(['GOO-1', 'GOO-2']);
    });

    it('get() returns default for non-existent path', () => {
      expect(manager.get('nonexistent.path', 'default')).toBe('default');
    });

    it('get() returns undefined for non-existent path without default', () => {
      expect(manager.get('nonexistent.path')).toBeUndefined();
    });

    it('has() returns true for existing paths', () => {
      manager.set('findings.all', []);

      expect(manager.has('findings.all')).toBe(true);
      expect(manager.has('findings.nonexistent')).toBe(false);
    });

    it('append() adds to array', () => {
      manager.set('issues.created', ['GOO-1']);

      manager.append('issues.created', 'GOO-2');

      expect(manager.get('issues.created')).toEqual(['GOO-1', 'GOO-2']);
    });

    it('append() creates array if not exists', () => {
      manager.append('newArray', 'item1');

      expect(manager.get('newArray')).toEqual(['item1']);
    });

    it('append() throws on non-array', () => {
      manager.set('notArray', { key: 'value' });

      expect(() => manager.append('notArray', 'item')).toThrow('Cannot append to non-array');
    });

    it('merge() merges objects', () => {
      manager.set('config', { a: 1, b: 2 });

      manager.merge('config', { b: 3, c: 4 });

      expect(manager.get('config')).toEqual({ a: 1, b: 3, c: 4 });
    });

    it('merge() creates object if not exists', () => {
      manager.merge('newObj', { key: 'value' });

      expect(manager.get('newObj')).toEqual({ key: 'value' });
    });

    it('merge() throws on non-object', () => {
      manager.set('isArray', [1, 2, 3]);

      expect(() => manager.merge('isArray', { key: 'value' })).toThrow('Cannot merge into non-object');
    });

    it('getContext() returns entire context object', () => {
      manager.set('findings.all', [{ id: 1 }]);
      manager.set('issues.created', ['GOO-1']);

      const context = manager.getContext();

      expect(context.findings.all).toEqual([{ id: 1 }]);
      expect(context.issues.created).toEqual(['GOO-1']);
    });
  });

  // ─────────────────────────────────────────────────────────────
  // Checkpoint Tests
  // ─────────────────────────────────────────────────────────────

  describe('Checkpoints', () => {
    beforeEach(() => {
      manager.start({ trigger: 'test' });
    });

    it('checkpoint() creates snapshot', () => {
      manager.set('custom.value', 100);

      const checkpointId = manager.checkpoint('before_risky_op');

      expect(checkpointId).toMatch(/^chk_\d+$/);
      expect(manager.getCheckpoints()).toHaveLength(1);
      expect(manager.getCheckpoints()[0].label).toBe('before_risky_op');
      expect(manager.getCheckpoints()[0].context.custom.value).toBe(100);
    });

    it('rollback() restores context', () => {
      manager.set('value', 100);
      const checkpointId = manager.checkpoint('before_change');

      manager.set('value', 999);
      expect(manager.get('value')).toBe(999);

      manager.rollback(checkpointId);

      expect(manager.get('value')).toBe(100);
    });

    it('rollback() throws on invalid checkpoint ID', () => {
      expect(() => manager.rollback('chk_invalid')).toThrow('Checkpoint not found');
    });

    it('getCheckpoints() returns all checkpoints', () => {
      manager.checkpoint('checkpoint1');
      manager.checkpoint('checkpoint2');
      manager.checkpoint('checkpoint3');

      const checkpoints = manager.getCheckpoints();

      expect(checkpoints).toHaveLength(3);
      expect(checkpoints.map(c => c.label)).toEqual(['checkpoint1', 'checkpoint2', 'checkpoint3']);
    });

    it('checkpoint saves stats snapshot', () => {
      manager.incrementStat('findingsProcessed', 5);
      const checkpointId = manager.checkpoint('with_stats');

      manager.incrementStat('findingsProcessed', 10);
      expect(manager.getStats().findingsProcessed).toBe(15);

      manager.rollback(checkpointId);

      expect(manager.getStats().findingsProcessed).toBe(5);
    });
  });

  // ─────────────────────────────────────────────────────────────
  // File Tracking Tests
  // ─────────────────────────────────────────────────────────────

  describe('File Tracking', () => {
    beforeEach(() => {
      manager.start({ trigger: 'test' });
    });

    it('trackFile() records file operation', () => {
      manager.trackFile('src/api/auth.ts', 'created');

      expect(manager.session.tracking.files.created).toHaveLength(1);
      expect(manager.session.tracking.files.created[0].path).toBe('src/api/auth.ts');
      expect(manager.session.tracking.files.created[0].timestamp).toBeDefined();
    });

    it('trackFile() normalizes absolute paths to relative', () => {
      const absolutePath = join(process.cwd(), 'src', 'test.js');

      manager.trackFile(absolutePath, 'modified');

      expect(manager.session.tracking.files.modified[0].path).toBe(join('src', 'test.js'));
    });

    it('trackFile() defaults to modified action', () => {
      manager.trackFile('src/file.ts');

      expect(manager.session.tracking.files.modified).toHaveLength(1);
    });

    it('trackFile() deduplicates same file and action', () => {
      manager.trackFile('src/file.ts', 'created');
      manager.trackFile('src/file.ts', 'created');

      expect(manager.session.tracking.files.created).toHaveLength(1);
    });

    it('trackFile() includes metadata', () => {
      manager.trackFile('src/file.ts', 'modified', { reason: 'refactor' });

      expect(manager.session.tracking.files.modified[0].reason).toBe('refactor');
    });

    it('trackFile() returns this for chaining', () => {
      const result = manager.trackFile('a.ts', 'created')
        .trackFile('b.ts', 'created')
        .trackFile('c.ts', 'modified');

      expect(result).toBe(manager);
      expect(manager.session.tracking.files.created).toHaveLength(2);
      expect(manager.session.tracking.files.modified).toHaveLength(1);
    });

    it('trackFiles() tracks multiple files', () => {
      manager.trackFiles(['src/a.ts', 'src/b.ts', 'src/c.ts'], 'created');

      expect(manager.session.tracking.files.created).toHaveLength(3);
    });

    it('trackFile() handles invalid action by defaulting to modified', () => {
      manager.trackFile('src/file.ts', 'invalid_action');

      expect(manager.session.tracking.files.modified).toHaveLength(1);
    });

    it('trackFile() adds workId when in work unit', () => {
      manager.startWork('fix-issue', { issueId: 'GOO-1' });
      manager.trackFile('src/fix.ts', 'modified');

      expect(manager.session.tracking.files.modified[0].workId).toBeDefined();
    });
  });

  // ─────────────────────────────────────────────────────────────
  // Issue Tracking Tests
  // ─────────────────────────────────────────────────────────────

  describe('Issue Tracking', () => {
    beforeEach(() => {
      manager.start({ trigger: 'test' });
    });

    it('trackIssue() records issue operation', () => {
      manager.trackIssue('GOO-53', 'created', { title: 'Fix auth bug' });

      expect(manager.session.tracking.issues.created).toHaveLength(1);
      expect(manager.session.tracking.issues.created[0].id).toBe('GOO-53');
      expect(manager.session.tracking.issues.created[0].title).toBe('Fix auth bug');
    });

    it('trackIssue() defaults to created action', () => {
      manager.trackIssue('GOO-54');

      expect(manager.session.tracking.issues.created).toHaveLength(1);
    });

    it('trackIssue() handles fixed status', () => {
      manager.trackIssue('GOO-55', 'fixed');

      expect(manager.session.tracking.issues.fixed).toHaveLength(1);
      expect(manager.getStats().fixesApplied).toBe(1);
    });

    it('trackIssue() handles skipped status', () => {
      manager.trackIssue('GOO-56', 'skipped', { reason: 'duplicate' });

      expect(manager.session.tracking.issues.skipped).toHaveLength(1);
      expect(manager.session.tracking.issues.skipped[0].reason).toBe('duplicate');
    });

    it('trackIssue() handles failed status', () => {
      manager.trackIssue('GOO-57', 'failed', { error: 'API timeout' });

      expect(manager.session.tracking.issues.failed).toHaveLength(1);
      expect(manager.session.tracking.issues.failed[0].error).toBe('API timeout');
    });

    it('trackIssue() deduplicates same issue and action', () => {
      manager.trackIssue('GOO-58', 'created');
      manager.trackIssue('GOO-58', 'created');

      expect(manager.session.tracking.issues.created).toHaveLength(1);
    });

    it('trackIssues() tracks multiple issues', () => {
      manager.trackIssues(['GOO-1', 'GOO-2', 'GOO-3'], 'created');

      expect(manager.session.tracking.issues.created).toHaveLength(3);
      expect(manager.getStats().issuesCreated).toBe(3);
    });

    it('trackIssue() adds workId when in work unit', () => {
      manager.startWork('code-review', {});
      manager.trackIssue('GOO-59', 'created');

      expect(manager.session.tracking.issues.created[0].workId).toBeDefined();
    });
  });

  // ─────────────────────────────────────────────────────────────
  // Finding Tracking Tests
  // ─────────────────────────────────────────────────────────────

  describe('Finding Tracking', () => {
    beforeEach(() => {
      manager.start({ trigger: 'test' });
    });

    it('trackFinding() records finding', () => {
      manager.trackFinding({
        type: 'security',
        file: 'src/auth.ts',
        description: 'Exposed API key',
        severity: 'critical',
      });

      expect(manager.session.tracking.findings).toHaveLength(1);
      expect(manager.session.tracking.findings[0].type).toBe('security');
      expect(manager.session.tracking.findings[0].file).toBe('src/auth.ts');
      expect(manager.getStats().findingsProcessed).toBe(1);
    });

    it('trackFinding() normalizes absolute paths', () => {
      const absolutePath = join(process.cwd(), 'src', 'vuln.js');
      manager.trackFinding({
        type: 'bug',
        file: absolutePath,
        description: 'Test bug',
      });

      expect(manager.session.tracking.findings[0].file).toBe(join('src', 'vuln.js'));
    });

    it('trackFindings() tracks multiple findings', () => {
      const findings = [
        { type: 'bug', file: 'a.js', description: 'Bug 1' },
        { type: 'bug', file: 'b.js', description: 'Bug 2' },
        { type: 'security', file: 'c.js', description: 'Security issue' },
      ];

      manager.trackFindings(findings);

      expect(manager.session.tracking.findings).toHaveLength(3);
      expect(manager.getStats().findingsProcessed).toBe(3);
    });

    it('trackFinding() adds workId when in work unit', () => {
      manager.startWork('code-review', {});
      manager.trackFinding({
        type: 'refactor',
        file: 'utils.js',
        description: 'Complex code',
      });

      expect(manager.session.tracking.findings[0].workId).toBeDefined();
    });
  });

  // ─────────────────────────────────────────────────────────────
  // Work Unit Tests
  // ─────────────────────────────────────────────────────────────

  describe('Work Units', () => {
    beforeEach(() => {
      manager.start({ trigger: 'test' });
    });

    it('startWork() begins work unit', () => {
      manager.startWork('fix-issue', { issueId: 'GOO-53', title: 'Fix bug' });

      expect(manager.getCurrentWork()).toBeDefined();
      expect(manager.getCurrentWork().type).toBe('fix-issue');
      expect(manager.getCurrentWork().metadata.issueId).toBe('GOO-53');
    });

    it('completeWork() finishes work unit with summary', () => {
      manager.startWork('fix-issue', { issueId: 'GOO-53' });
      manager.trackFile('src/fix.ts', 'modified');
      manager.trackIssue('GOO-53', 'fixed');

      const summary = manager.completeWork({ success: true });

      expect(summary.filesModified).toBe(1);
      expect(summary.issuesFixed).toBe(1);
      expect(summary.success).toBe(true);
      expect(manager.getCurrentWork()).toBeNull();
    });

    it('completeWork() calculates work-specific totals', () => {
      // Track some items without work unit
      manager.trackFile('outside.ts', 'created');

      // Start work unit and track more
      manager.startWork('feature', { name: 'new-feature' });
      manager.trackFile('inside1.ts', 'created');
      manager.trackFile('inside2.ts', 'created');

      const summary = manager.completeWork();

      expect(summary.filesCreated).toBe(2); // Only files within work unit
    });

    it('getCompletedWork() returns all completed work units', () => {
      manager.startWork('task1', {});
      manager.completeWork({ success: true });

      manager.startWork('task2', {});
      manager.completeWork({ success: false });

      const completed = manager.getCompletedWork();

      expect(completed).toHaveLength(2);
      expect(completed[0].type).toBe('task1');
      expect(completed[1].type).toBe('task2');
    });

    it('completeWork() without startWork() creates ad-hoc summary', () => {
      manager.trackFile('src/file.ts', 'modified');

      const summary = manager.completeWork({ note: 'ad-hoc' });

      expect(summary.filesModified).toBe(1);
      expect(summary.note).toBe('ad-hoc');
    });

    it('getTrackingSummary() returns summary of all tracked items', () => {
      manager.trackFile('a.ts', 'created');
      manager.trackFile('b.ts', 'modified');
      manager.trackFile('c.ts', 'deleted');
      manager.trackIssue('GOO-1', 'created');
      manager.trackIssue('GOO-2', 'fixed');
      manager.trackFinding({ type: 'bug', file: 'd.ts', description: 'bug' });

      const summary = manager.getTrackingSummary();

      expect(summary.filesCreated).toBe(1);
      expect(summary.filesModified).toBe(1);
      expect(summary.filesDeleted).toBe(1);
      expect(summary.issuesCreated).toBe(1);
      expect(summary.issuesFixed).toBe(1);
      expect(summary.findingsProcessed).toBe(1);
    });
  });

  // ─────────────────────────────────────────────────────────────
  // Invocation Tracking Tests
  // ─────────────────────────────────────────────────────────────

  describe('Invocation Tracking', () => {
    beforeEach(() => {
      manager.start({ trigger: 'test' });
    });

    it('recordInvocation() records agent invocation', () => {
      const invocationId = manager.recordInvocation('issue-creator', { findings: [] }, 'review-orchestrator');

      expect(invocationId).toMatch(/^inv_\d+_[a-z0-9]+$/);
      expect(manager.getInvocationChain()).toHaveLength(1);
      expect(manager.getInvocationChain()[0].agent).toBe('issue-creator');
      expect(manager.getStats().agentsInvoked).toBe(1);
    });

    it('recordInvocationResult() updates invocation', () => {
      const invocationId = manager.recordInvocation('auto-fixer', { issue: 'GOO-1' });

      manager.recordInvocationResult(invocationId, { success: true, filesModified: 2 });

      const invocation = manager.getInvocationChain().find(i => i.id === invocationId);
      expect(invocation.status).toBe('success');
      expect(invocation.completedAt).toBeDefined();
    });

    it('recordInvocationResult() handles failure status', () => {
      const invocationId = manager.recordInvocation('auto-fixer', { issue: 'GOO-1' });

      manager.recordInvocationResult(invocationId, { error: 'Compilation failed' }, 'failed');

      const invocation = manager.getInvocationChain().find(i => i.id === invocationId);
      expect(invocation.status).toBe('failed');
    });
  });

  // ─────────────────────────────────────────────────────────────
  // Event Timeline Tests
  // ─────────────────────────────────────────────────────────────

  describe('Event Timeline', () => {
    beforeEach(() => {
      manager.start({ trigger: 'test' });
    });

    it('addEvent() adds event to timeline', () => {
      manager.addEvent('custom_event', { key: 'value' });

      const events = manager.getEvents('custom_event');

      expect(events).toHaveLength(1);
      expect(events[0].data.key).toBe('value');
      expect(events[0].timestamp).toBeDefined();
    });

    it('getEvents() returns all events when no type specified', () => {
      manager.addEvent('event1', {});
      manager.addEvent('event2', {});
      manager.addEvent('event1', {});

      expect(manager.getEvents()).toHaveLength(3);
      expect(manager.getEvents('event1')).toHaveLength(2);
      expect(manager.getEvents('event2')).toHaveLength(1);
    });
  });

  // ─────────────────────────────────────────────────────────────
  // Error Tracking Tests
  // ─────────────────────────────────────────────────────────────

  describe('Error Tracking', () => {
    beforeEach(() => {
      manager.start({ trigger: 'test' });
    });

    it('recordError() stores error context', () => {
      const error = new Error('Something went wrong');

      manager.recordError(error, { operation: 'fetchData' });

      const errors = manager.getErrors();
      expect(errors).toHaveLength(1);
      expect(errors[0].message).toBe('Something went wrong');
      expect(errors[0].stack).toBeDefined();
      expect(errors[0].context.operation).toBe('fetchData');
      expect(manager.getStats().errorsEncountered).toBe(1);
    });

    it('recordError() handles string errors', () => {
      manager.recordError('String error message', { step: 3 });

      const errors = manager.getErrors();
      expect(errors[0].message).toBe('String error message');
      expect(errors[0].stack).toBeNull();
    });

    it('getErrors() returns recorded errors', () => {
      manager.recordError('Error 1');
      manager.recordError('Error 2');

      expect(manager.getErrors()).toHaveLength(2);
    });
  });

  // ─────────────────────────────────────────────────────────────
  // Statistics Tests
  // ─────────────────────────────────────────────────────────────

  describe('Statistics', () => {
    beforeEach(() => {
      manager.start({ trigger: 'test' });
    });

    it('incrementStat() increments stat counter', () => {
      expect(manager.getStats().findingsProcessed).toBe(0);

      manager.incrementStat('findingsProcessed', 5);

      expect(manager.getStats().findingsProcessed).toBe(5);
    });

    it('incrementStat() defaults to increment by 1', () => {
      manager.incrementStat('issuesCreated');
      manager.incrementStat('issuesCreated');

      expect(manager.getStats().issuesCreated).toBe(2);
    });

    it('incrementStat() ignores invalid stat names', () => {
      manager.incrementStat('nonexistentStat', 10);

      expect(manager.getStats().nonexistentStat).toBeUndefined();
    });

    it('getStats() returns current stats', () => {
      const stats = manager.getStats();

      expect(stats).toHaveProperty('agentsInvoked');
      expect(stats).toHaveProperty('findingsProcessed');
      expect(stats).toHaveProperty('issuesCreated');
      expect(stats).toHaveProperty('fixesApplied');
      expect(stats).toHaveProperty('errorsEncountered');
    });
  });

  // ─────────────────────────────────────────────────────────────
  // Session Summary Tests
  // ─────────────────────────────────────────────────────────────

  describe('Session Summary', () => {
    beforeEach(() => {
      manager.start({ trigger: 'test' });
    });

    it('getSummary() returns session summary', () => {
      manager.markRunning();
      manager.recordInvocation('test-agent', {});
      manager.recordError('test error');

      const summary = manager.getSummary();

      expect(summary.id).toBe(manager.getId());
      expect(summary.state).toBe(SESSION_STATES.RUNNING);
      expect(summary.trigger).toBe('test');
      expect(summary.stats).toBeDefined();
      expect(summary.agentChain).toHaveLength(1);
      expect(summary.errorCount).toBe(1);
    });

    it('getSummary() calculates duration', () => {
      const summary = manager.getSummary();

      expect(summary.duration).toBeGreaterThanOrEqual(0);
    });
  });

  // ─────────────────────────────────────────────────────────────
  // Memory Management Tests
  // ─────────────────────────────────────────────────────────────

  describe('Memory Management', () => {
    it('destroy() clears timers', () => {
      const manager = new SessionContextManager({ basePath: testBasePath, autoSave: true });
      manager.start({ trigger: 'test' });

      manager.destroy();

      expect(manager.session).toBeNull();
      expect(manager._saveTimer).toBeNull();
    });

    it('destroy() prevents further saves', () => {
      manager.start({ trigger: 'test' });
      const sessionId = manager.getId();

      manager.destroy();

      manager._save(); // Should not throw, just do nothing
      expect(manager.session).toBeNull();
    });
  });

  // ─────────────────────────────────────────────────────────────
  // Edge Cases
  // ─────────────────────────────────────────────────────────────

  describe('Edge Cases', () => {
    it('handles operations on null session gracefully', () => {
      // Don't start a session
      expect(manager.getId()).toBeNull();
      expect(manager.getState()).toBeNull();
      expect(manager.get('any.path')).toBeUndefined();
      expect(manager.getContext()).toEqual({});
      expect(manager.getCheckpoints()).toEqual([]);
      expect(manager.getInvocationChain()).toEqual([]);
      expect(manager.getEvents()).toEqual([]);
      expect(manager.getErrors()).toEqual([]);
      expect(manager.getStats()).toEqual({});
      expect(manager.getSummary()).toBeNull();

      // These should not throw
      manager.set('test', 'value');
      manager.markRunning();
      manager.pause();
      manager.complete();
      manager.fail('error');
      manager.addEvent('test', {});
      manager.recordError('error');
    });

    it('handles missing optional fields in resumed session', () => {
      // Create a minimal session file
      const sessionId = `session_${Date.now()}_test`;
      const sessionPath = join(testBasePath, `${sessionId}.json`);
      mkdirSync(testBasePath, { recursive: true });

      // Session without tracking structure (old format)
      const oldSession = {
        id: sessionId,
        state: SESSION_STATES.PAUSED,
        metadata: { trigger: 'test' },
        timestamps: { created: new Date().toISOString(), updated: new Date().toISOString() },
        context: { findings: {}, issues: {}, fixes: {}, errors: [], custom: {} },
        invocations: [],
        events: [],
        checkpoints: [],
        stats: { agentsInvoked: 0, findingsProcessed: 0, issuesCreated: 0, fixesApplied: 0, errorsEncountered: 0 },
      };
      writeFileSync(sessionPath, JSON.stringify(oldSession));

      const resumed = SessionContextManager.resume(sessionId, { basePath: testBasePath, autoSave: false });

      // _ensureTracking should create the tracking structure
      resumed.trackFile('test.js', 'created');

      expect(resumed.session.tracking).toBeDefined();
      expect(resumed.session.tracking.files.created).toHaveLength(1);

      resumed.destroy();
    });

    it('handles very large tracking arrays', () => {
      manager.start({ trigger: 'test' });

      // Track 1000 files
      for (let i = 0; i < 1000; i++) {
        manager.trackFile(`src/file${i}.ts`, 'modified');
      }

      expect(manager.session.tracking.files.modified).toHaveLength(1000);

      const summary = manager.getTrackingSummary();
      expect(summary.filesModified).toBe(1000);
    });

    it('sanitizes large data for logging', () => {
      manager.start({ trigger: 'test' });

      const largeArray = Array(100).fill({ data: 'item' });
      const result = manager._sanitizeForLog({ items: largeArray });

      expect(result.items).toBe('[Array: 100 items]');
    });

    it('sanitizes long strings for logging', () => {
      manager.start({ trigger: 'test' });

      const longString = 'x'.repeat(1000);
      const result = manager._sanitizeForLog({ content: longString });

      expect(result.content.length).toBeLessThan(510);
      expect(result.content.endsWith('...')).toBe(true);
    });
  });

  // ─────────────────────────────────────────────────────────────
  // createSessionContext Helper Tests
  // ─────────────────────────────────────────────────────────────

  describe('createSessionContext Helper', () => {
    it('creates a SessionContextManager instance', () => {
      const session = createSessionContext({ basePath: testBasePath, autoSave: false });

      expect(session).toBeInstanceOf(SessionContextManager);

      // Need to start a session to use it
      session.start({ trigger: 'test-helper' });
      expect(session.getId()).toBeDefined();
      expect(session.getState()).toBe(SESSION_STATES.CREATED);

      session.destroy();
    });
  });

  // ─────────────────────────────────────────────────────────────
  // Summary Conflict Detection Tests
  // ─────────────────────────────────────────────────────────────

  describe('Summary Conflict Detection', () => {
    beforeEach(() => {
      manager.start({ trigger: 'test' });
    });

    it('detects conflicts between provided and derived summary values', () => {
      manager.trackIssue('GOO-1', 'created');
      manager.trackIssue('GOO-2', 'created');
      manager.trackIssue('GOO-3', 'fixed');

      // Provide conflicting values
      manager.complete({ issuesCreated: 10 }); // Derived would be 2

      expect(manager.session.summary._hasConflicts).toBe(true);

      // Check that conflict was recorded in events
      const conflictEvents = manager.getEvents('summary_conflicts');
      expect(conflictEvents.length).toBeGreaterThanOrEqual(1);
    });

    it('does not flag conflict when derived value is zero', () => {
      // No issues tracked, derived issuesCreated = 0

      manager.complete({ issuesCreated: 5 });

      // Should not be flagged as conflict since we didn't track anything
      expect(manager.session.summary._hasConflicts).toBe(false);
    });
  });
});
