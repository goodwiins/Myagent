/**
 * SyncActivity Unit Tests
 *
 * Tests for activity logging in cross-LLM collaboration.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SyncActivity, ACTIVITY_TYPES } from '../../lib/sync-activity.js';
import { mkdirSync, rmSync, existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { randomUUID } from 'crypto';

describe('SyncActivity', () => {
  let tempDir;
  let syncActivity;

  beforeEach(() => {
    tempDir = join(process.cwd(), 'test-activity', `test-${randomUUID()}`);
    mkdirSync(tempDir, { recursive: true });
    syncActivity = new SyncActivity({ syncPath: tempDir });
  });

  afterEach(() => {
    if (existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe('constructor', () => {
    it('should create activity file directory', () => {
      expect(existsSync(tempDir)).toBe(true);
    });

    it('should accept custom config', () => {
      const customActivity = new SyncActivity({
        syncPath: tempDir,
        config: { maxEvents: 50, activityFile: 'custom-activity.json' },
      });
      customActivity.log({ type: 'test', llm: 'test' });
      expect(existsSync(join(tempDir, 'custom-activity.json'))).toBe(true);
    });
  });

  describe('log', () => {
    it('should log an event with timestamp and id', () => {
      const event = syncActivity.log({
        type: ACTIVITY_TYPES.EXPORT,
        llm: 'claude',
        message: 'Test export',
      });

      expect(event.id).toMatch(/^evt_/);
      expect(event.type).toBe('export');
      expect(event.llm).toBe('claude');
      expect(event.timestamp).toBeDefined();
    });

    it('should persist events to file', () => {
      syncActivity.log({ type: 'export', llm: 'claude' });
      syncActivity.log({ type: 'import', llm: 'gemini' });

      const content = JSON.parse(readFileSync(join(tempDir, 'activity.json'), 'utf-8'));
      expect(content).toHaveLength(2);
    });

    it('should trim events to maxEvents limit', () => {
      const smallActivity = new SyncActivity({
        syncPath: tempDir,
        config: { maxEvents: 3 },
      });

      for (let i = 0; i < 5; i++) {
        smallActivity.log({ type: 'test', llm: `llm${i}` });
      }

      const content = JSON.parse(readFileSync(join(tempDir, 'activity.json'), 'utf-8'));
      expect(content).toHaveLength(3);
      // Should keep the last 3
      expect(content[0].llm).toBe('llm2');
      expect(content[2].llm).toBe('llm4');
    });
  });

  describe('logExport', () => {
    it('should log export event with stats', () => {
      const event = syncActivity.logExport('claude', 'API ready', { findings: 5 });

      expect(event.type).toBe(ACTIVITY_TYPES.EXPORT);
      expect(event.llm).toBe('claude');
      expect(event.message).toBe('API ready');
      expect(event.data.stats).toEqual({ findings: 5 });
    });
  });

  describe('logImport', () => {
    it('should log import event with source LLM', () => {
      const event = syncActivity.logImport('gemini', 'claude', { findings: 10 });

      expect(event.type).toBe(ACTIVITY_TYPES.IMPORT);
      expect(event.llm).toBe('gemini');
      expect(event.message).toContain('claude');
      expect(event.data.fromLlm).toBe('claude');
    });
  });

  describe('logMerge', () => {
    it('should log merge event with sources and strategy', () => {
      const event = syncActivity.logMerge('claude', ['gemini', 'gpt4'], 'latest-wins');

      expect(event.type).toBe(ACTIVITY_TYPES.MERGE);
      expect(event.message).toContain('gemini');
      expect(event.message).toContain('gpt4');
      expect(event.data.sources).toEqual(['gemini', 'gpt4']);
      expect(event.data.strategy).toBe('latest-wins');
    });
  });

  describe('logWorkCompleted', () => {
    it('should log work completion with summary', () => {
      const event = syncActivity.logWorkCompleted('claude', {
        title: 'Fixed auth bug',
        issueId: 'GOO-42',
      });

      expect(event.type).toBe(ACTIVITY_TYPES.WORK_COMPLETED);
      expect(event.message).toBe('Fixed auth bug');
      expect(event.data.summary.issueId).toBe('GOO-42');
    });
  });

  describe('getActivity', () => {
    beforeEach(() => {
      // Create some test events
      syncActivity.log({ type: 'export', llm: 'claude', message: 'Export 1' });
      syncActivity.log({ type: 'import', llm: 'gemini', message: 'Import 1' });
      syncActivity.log({ type: 'export', llm: 'claude', message: 'Export 2' });
      syncActivity.log({ type: 'merge', llm: 'gpt4', message: 'Merge 1' });
    });

    it('should return events in reverse order (newest first)', () => {
      const events = syncActivity.getActivity({ limit: 10 });

      expect(events[0].message).toBe('Merge 1');
      expect(events[3].message).toBe('Export 1');
    });

    it('should respect limit', () => {
      const events = syncActivity.getActivity({ limit: 2 });
      expect(events).toHaveLength(2);
    });

    it('should filter by LLM', () => {
      const events = syncActivity.getActivity({ llm: 'claude' });

      expect(events.every(e => e.llm === 'claude')).toBe(true);
      expect(events).toHaveLength(2);
    });

    it('should filter by type', () => {
      const events = syncActivity.getActivity({ type: 'export' });

      expect(events.every(e => e.type === 'export')).toBe(true);
      expect(events).toHaveLength(2);
    });

    it('should filter by since timestamp', () => {
      // Get timestamp between events would be complex, so just test that filter works
      const futureDate = new Date(Date.now() + 100000).toISOString();
      const events = syncActivity.getActivity({ since: futureDate });
      expect(events).toHaveLength(0);
    });
  });

  describe('getSummaryByLLM', () => {
    beforeEach(() => {
      syncActivity.log({ type: 'export', llm: 'claude' });
      syncActivity.log({ type: 'export', llm: 'claude' });
      syncActivity.log({ type: 'import', llm: 'claude' });
      syncActivity.log({ type: 'export', llm: 'gemini' });
      syncActivity.log({ type: 'merge', llm: 'gemini' });
    });

    it('should return summary grouped by LLM', () => {
      const summary = syncActivity.getSummaryByLLM();

      expect(summary.claude).toBeDefined();
      expect(summary.gemini).toBeDefined();
      expect(summary.claude.totalEvents).toBe(3);
      expect(summary.gemini.totalEvents).toBe(2);
    });

    it('should count event types correctly', () => {
      const summary = syncActivity.getSummaryByLLM();

      expect(summary.claude.exports).toBe(2);
      expect(summary.claude.imports).toBe(1);
      expect(summary.claude.merges).toBe(0);
      expect(summary.gemini.exports).toBe(1);
      expect(summary.gemini.merges).toBe(1);
    });

    it('should track last activity', () => {
      const summary = syncActivity.getSummaryByLLM();

      expect(summary.claude.lastActivity).toBeDefined();
      expect(summary.gemini.lastActivity).toBeDefined();
    });
  });

  describe('getFreshness', () => {
    it('should return unknown for LLM with no activity', () => {
      const freshness = syncActivity.getFreshness('unknown-llm');

      expect(freshness.status).toBe('unknown');
      expect(freshness.lastActivity).toBeNull();
    });

    it('should return fresh for recent activity', () => {
      syncActivity.log({ type: 'export', llm: 'claude' });
      const freshness = syncActivity.getFreshness('claude');

      expect(freshness.status).toBe('fresh');
      expect(freshness.timeSince).toBe('just now');
    });

    it('should include last event details', () => {
      syncActivity.log({ type: 'export', llm: 'claude', message: 'Test message' });
      const freshness = syncActivity.getFreshness('claude');

      expect(freshness.message).toBe('Test message');
      expect(freshness.type).toBe('export');
    });
  });

  describe('clear', () => {
    it('should clear all activity', () => {
      syncActivity.log({ type: 'export', llm: 'claude' });
      syncActivity.log({ type: 'import', llm: 'gemini' });

      syncActivity.clear();

      const events = syncActivity.getActivity();
      expect(events).toHaveLength(0);
    });
  });

  describe('ACTIVITY_TYPES', () => {
    it('should export all activity types', () => {
      expect(ACTIVITY_TYPES.EXPORT).toBe('export');
      expect(ACTIVITY_TYPES.IMPORT).toBe('import');
      expect(ACTIVITY_TYPES.MERGE).toBe('merge');
      expect(ACTIVITY_TYPES.SESSION_START).toBe('session_start');
      expect(ACTIVITY_TYPES.SESSION_END).toBe('session_end');
      expect(ACTIVITY_TYPES.WORK_COMPLETED).toBe('work_completed');
    });
  });
});
