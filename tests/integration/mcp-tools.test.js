/**
 * Integration tests for MCP server tool handlers
 *
 * These tests verify that the core GoodFlows modules work together correctly
 * as they would be used by the MCP server.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

import { ContextStore } from '../../lib/context-store.js';
import { SessionContextManager } from '../../lib/session-context.js';
import { PatternTracker } from '../../lib/pattern-tracker.js';
import { PriorityQueue, PRIORITY } from '../../lib/priority-queue.js';
import { ContextFileManager } from '../../lib/context-files.js';

// Test directory
const TEST_DIR = join(tmpdir(), `goodflows-test-${Date.now()}`);
const GOODFLOWS_DIR = join(TEST_DIR, '.goodflows');

describe('MCP Tool Integration', () => {
  beforeEach(() => {
    mkdirSync(GOODFLOWS_DIR, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true, force: true });
    }
  });

  describe('Context Store + Session workflow', () => {
    it('should add findings and query them within a session', () => {
      const store = new ContextStore({ basePath: join(GOODFLOWS_DIR, 'context') });
      const session = new SessionContextManager({
        basePath: join(GOODFLOWS_DIR, 'sessions'),
        autoSave: false,
      });

      // Start session
      const sessionId = session.start({ trigger: 'code-review' });
      expect(sessionId).toBeTruthy();

      // Add findings
      const finding1 = store.addFinding({
        file: 'src/auth.js',
        lines: '45-52',
        type: 'critical_security',
        description: 'Hardcoded API key in source code',
        severity: 'high',
      });

      const finding2 = store.addFinding({
        file: 'src/api.js',
        lines: '100-105',
        type: 'potential_issue',
        description: 'Missing null check before property access',
        severity: 'medium',
      });

      expect(finding1.added).toBe(true);
      expect(finding2.added).toBe(true);

      // Store finding hashes in session
      session.set('findings.hashes', [finding1.hash, finding2.hash]);
      session.set('findings.count', 2);

      // Query findings
      const securityFindings = store.query({ type: 'critical_security' });
      expect(securityFindings).toHaveLength(1);
      expect(securityFindings[0].file).toBe('src/auth.js');

      // Verify session context
      expect(session.get('findings.count')).toBe(2);

      // Complete session
      session.complete({ totalFindings: 2 });
    });

    it('should handle duplicate findings', () => {
      const store = new ContextStore({ basePath: join(GOODFLOWS_DIR, 'context') });

      const finding = {
        file: 'src/utils.js',
        type: 'refactor_suggestion',
        description: 'Function is too complex',
      };

      const first = store.addFinding(finding);
      const second = store.addFinding(finding);

      expect(first.added).toBe(true);
      expect(second.added).toBe(false);
      expect(second.duplicate).toBe(true);
      expect(first.hash).toBe(second.hash);
    });
  });

  describe('Priority Queue + Pattern Tracker workflow', () => {
    it('should process findings in priority order with pattern recommendations', () => {
      const tracker = new PatternTracker({
        basePath: join(GOODFLOWS_DIR, 'patterns'),
        includeBuiltins: true,
      });
      const queue = new PriorityQueue({ maxRetries: 2 });

      // Add findings to queue
      const findings = [
        { type: 'documentation', file: 'README.md', description: 'Missing docs' },
        { type: 'critical_security', file: 'auth.js', description: 'Hardcoded secret key' },
        { type: 'potential_issue', file: 'api.js', description: 'Null pointer risk' },
      ];

      const result = queue.enqueueAll(findings);
      expect(result.added).toBe(3);

      // Process in priority order
      const first = queue.dequeue();
      expect(first.type).toBe('critical_security'); // P1

      // Get pattern recommendation
      const patterns = tracker.recommend(first);
      expect(patterns.length).toBeGreaterThan(0);
      expect(patterns[0].patternId).toBe('env-var-secret');

      // Mark as completed
      queue.markCompleted({ fixed: true, patternUsed: 'env-var-secret' });

      // Record pattern success (skip for builtin patterns that don't have filesApplied)
      // In production, recordSuccess is typically called for custom patterns

      // Continue processing
      const second = queue.dequeue();
      expect(second.type).toBe('potential_issue'); // P2

      const third = queue.dequeue();
      expect(third.type).toBe('documentation'); // P4

      expect(queue.isEmpty()).toBe(true);
    });

    it('should respect maxSize and evict lowest priority items', () => {
      const queue = new PriorityQueue({ maxSize: 2 });

      queue.enqueue({ type: 'documentation', id: 'low' });
      queue.enqueue({ type: 'critical_security', id: 'urgent' });
      queue.enqueue({ type: 'potential_issue', id: 'high' });

      expect(queue.size()).toBe(2);
      expect(queue.evicted).toHaveLength(1);
      expect(queue.evicted[0].id).toBe('low');

      const stats = queue.getStats();
      expect(stats.evicted).toBe(1);
      expect(stats.maxSize).toBe(2);
    });
  });

  describe('Session checkpoints and rollback', () => {
    it('should checkpoint and rollback session state', () => {
      const session = new SessionContextManager({
        basePath: join(GOODFLOWS_DIR, 'sessions'),
        autoSave: false,
      });

      session.start({ trigger: 'fix-issues' });

      // Initial state
      session.set('issues.pending', ['GOO-1', 'GOO-2', 'GOO-3']);
      session.set('phase', 'fixing');

      // Create checkpoint before fixes
      const checkpointId = session.checkpoint('before_fixes');
      expect(checkpointId).toBeTruthy();

      // Simulate fixing issues
      session.set('issues.pending', ['GOO-3']);
      session.set('issues.fixed', ['GOO-1', 'GOO-2']);
      session.set('files.modified', ['src/auth.js', 'src/api.js']);

      expect(session.get('issues.fixed')).toHaveLength(2);

      // Rollback to checkpoint
      const success = session.rollback(checkpointId);
      expect(success).toBe(true);

      // Verify rollback
      expect(session.get('issues.pending')).toHaveLength(3);
      expect(session.get('issues.fixed')).toBeUndefined();
      expect(session.get('files.modified')).toBeUndefined();
    });
  });

  describe('Context Files workflow', () => {
    it('should read and write context files', async () => {
      const manager = new ContextFileManager({
        basePath: TEST_DIR, // Use TEST_DIR as project root
      });

      // Initialize with templates
      await manager.init();

      // Write to STATE.md
      const stateContent = `# Current State
## Session
- ID: test-session-123
- Started: 2025-01-12

## Position
Working on auth module fixes
`;

      const writeResult = await manager.write('STATE', stateContent);
      expect(writeResult.success).toBe(true);

      // Read it back
      const readResult = await manager.read('STATE');
      expect(readResult.exists).toBe(true);
      expect(readResult.content).toContain('test-session-123');
      expect(readResult.content).toContain('auth module fixes');

      // Check status
      const statusResult = await manager.status();
      expect(statusResult.files.STATE.exists).toBe(true);
      expect(statusResult.files.STATE.withinLimit).toBe(true);
    });
  });

  describe('End-to-end: Code review workflow', () => {
    it('should simulate a complete code review workflow', async () => {
      // Initialize all components
      const store = new ContextStore({ basePath: join(GOODFLOWS_DIR, 'context') });
      const session = new SessionContextManager({
        basePath: join(GOODFLOWS_DIR, 'sessions'),
        autoSave: false,
      });
      const tracker = new PatternTracker({
        basePath: join(GOODFLOWS_DIR, 'patterns'),
      });
      const queue = new PriorityQueue();

      // 1. Start review session
      const sessionId = session.start({
        trigger: 'code-review',
        pr: 'PR-123',
        branch: 'feature/auth',
      });

      // 2. Simulate CodeRabbit findings
      const findings = [
        { file: 'src/auth.js', type: 'critical_security', description: 'Hardcoded password' },
        { file: 'src/api.js', type: 'potential_issue', description: 'Race condition in async code' },
        { file: 'src/utils.js', type: 'refactor_suggestion', description: 'Complex function needs splitting' },
        { file: 'docs/api.md', type: 'documentation', description: 'Missing API documentation' },
      ];

      // 3. Add to context store and queue
      const hashes = [];
      for (const finding of findings) {
        const result = store.addFinding(finding);
        hashes.push(result.hash);
      }
      queue.enqueueAll(findings);

      session.set('findings.hashes', hashes);
      session.set('findings.total', findings.length);

      // 4. Process findings in priority order
      const fixed = [];
      while (!queue.isEmpty()) {
        const item = queue.dequeue();

        // Get pattern recommendation
        const patterns = tracker.recommend(item);

        // Simulate fix
        const patternUsed = patterns.length > 0 ? patterns[0].patternId : null;
        fixed.push({
          file: item.file,
          type: item.type,
          patternUsed,
        });

        queue.markCompleted({ patternUsed });

        // Note: recordSuccess would be called for custom patterns
        // Built-in patterns are read-only
      }

      // 5. Update session with results
      session.set('issues.fixed', fixed.map(f => f.file));
      session.set('patterns.used', fixed.filter(f => f.patternUsed).map(f => f.patternUsed));

      // 6. Complete session
      session.complete({
        totalFindings: findings.length,
        totalFixed: fixed.length,
        patternsUsed: session.get('patterns.used')?.length || 0,
      });

      // Verify final state
      const stats = queue.getStats();
      expect(stats.completed).toBe(4);
      expect(stats.pending).toBe(0);

      const storeStats = store.getStats();
      expect(storeStats.totalFindings).toBe(4);

      // Verify processing order (by priority)
      expect(fixed[0].type).toBe('critical_security'); // P1
      expect(fixed[1].type).toBe('potential_issue');   // P2
      expect(fixed[2].type).toBe('refactor_suggestion'); // P3
      expect(fixed[3].type).toBe('documentation');      // P4
    });
  });
});
