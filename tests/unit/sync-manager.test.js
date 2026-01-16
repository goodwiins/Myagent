/**
 * SyncManager Unit Tests
 *
 * Tests for cross-CLI synchronization functionality.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SyncManager } from '../../lib/sync-manager.js';
import { mkdirSync, rmSync, existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { randomUUID } from 'crypto';

describe('SyncManager', () => {
  let tempDir;
  let syncManager;

  beforeEach(() => {
    // Create unique temp directory for each test
    tempDir = join(process.cwd(), 'test-sync', `test-${randomUUID()}`);
    mkdirSync(tempDir, { recursive: true });
    syncManager = new SyncManager({ basePath: tempDir });
  });

  afterEach(() => {
    // Cleanup
    if (existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe('constructor', () => {
    it('should create sync directory on initialization', () => {
      const syncPath = join(tempDir, '.goodflows', 'sync');
      expect(existsSync(syncPath)).toBe(true);
    });

    it('should accept custom config', () => {
      const customManager = new SyncManager({
        basePath: tempDir,
        config: { syncDir: '.custom-sync' },
      });
      const customPath = join(tempDir, '.custom-sync');
      expect(existsSync(customPath)).toBe(true);
    });
  });

  describe('export', () => {
    it('should export context with LLM identifier', () => {
      const result = syncManager.export({
        llm: 'claude',
        projectContext: {
          project: { name: 'test-project', version: '1.0.0' },
          github: { url: 'https://github.com/test/repo' },
        },
      });

      expect(result.success).toBe(true);
      expect(result.llm).toBe('claude');
      expect(result.path).toContain('handoff-claude.json');
    });

    it('should export session data when provided', () => {
      const mockSession = {
        getId: () => 'session_123',
        getState: () => 'running',
        getStats: () => ({ events: 5 }),
        getCurrentWork: () => ({ type: 'fix-issue' }),
        getCompletedWork: () => [{ type: 'code-review' }],
        getTrackingSummary: () => ({
          files: { created: ['src/api.js'], modified: [], deleted: [] },
          issues: { created: [], fixed: ['GOO-1'], skipped: [], failed: [] },
          findings: [],
          work: [],
        }),
        getEvents: () => [{ type: 'start' }],
        session: { metadata: { trigger: 'test' }, context: {} },
      };

      const result = syncManager.export({
        llm: 'claude',
        session: mockSession,
      });

      expect(result.success).toBe(true);

      // Read the file and verify session data
      const content = JSON.parse(readFileSync(result.path, 'utf-8'));
      expect(content.session.id).toBe('session_123');
      expect(content.session.tracking.files.created).toContain('src/api.js');
    });

    it('should filter by role (backend)', () => {
      const mockSession = {
        getId: () => 'session_123',
        getState: () => 'running',
        getStats: () => ({}),
        getCurrentWork: () => null,
        getCompletedWork: () => [],
        getTrackingSummary: () => ({
          files: {
            created: ['src/api/users.js', 'src/components/Button.jsx', 'lib/utils.js'],
            modified: [],
            deleted: [],
          },
          issues: { created: [], fixed: [], skipped: [], failed: [] },
          findings: [],
          work: [],
        }),
        getEvents: () => [],
        session: { metadata: {}, context: {} },
      };

      const result = syncManager.export({
        llm: 'claude',
        session: mockSession,
        role: 'backend',
      });

      const content = JSON.parse(readFileSync(result.path, 'utf-8'));
      // Should include backend files, exclude frontend
      expect(content.session.tracking.files.created).toContain('src/api/users.js');
      expect(content.session.tracking.files.created).toContain('lib/utils.js');
      expect(content.session.tracking.files.created).not.toContain('src/components/Button.jsx');
    });

    it('should filter by role (frontend)', () => {
      const mockSession = {
        getId: () => 'session_123',
        getState: () => 'running',
        getStats: () => ({}),
        getCurrentWork: () => null,
        getCompletedWork: () => [],
        getTrackingSummary: () => ({
          files: {
            created: ['src/api/users.js', 'src/components/Button.jsx', 'src/pages/Home.tsx'],
            modified: [],
            deleted: [],
          },
          issues: { created: [], fixed: [], skipped: [], failed: [] },
          findings: [],
          work: [],
        }),
        getEvents: () => [],
        session: { metadata: {}, context: {} },
      };

      const result = syncManager.export({
        llm: 'gemini',
        session: mockSession,
        role: 'frontend',
      });

      const content = JSON.parse(readFileSync(result.path, 'utf-8'));
      // Should include frontend files, exclude backend
      expect(content.session.tracking.files.created).toContain('src/components/Button.jsx');
      expect(content.session.tracking.files.created).toContain('src/pages/Home.tsx');
      expect(content.session.tracking.files.created).not.toContain('src/api/users.js');
    });

    it('should include message for receiving LLM', () => {
      const result = syncManager.export({
        llm: 'claude',
        message: 'API endpoints ready for frontend integration',
      });

      const content = JSON.parse(readFileSync(result.path, 'utf-8'));
      expect(content.message).toBe('API endpoints ready for frontend integration');
    });

    it('should throw error without LLM identifier', () => {
      expect(() => syncManager.export({})).toThrow('LLM identifier is required');
    });

    it('should export findings filtered by role', () => {
      const findings = [
        { type: 'bug', file: 'src/api/auth.js', description: 'Missing validation' },
        { type: 'bug', file: 'src/components/Form.jsx', description: 'XSS vulnerability' },
        { type: 'security', file: 'lib/crypto.js', description: 'Weak hash' },
      ];

      const result = syncManager.export({
        llm: 'claude',
        findings,
        role: 'backend',
      });

      const content = JSON.parse(readFileSync(result.path, 'utf-8'));
      expect(content.findings.length).toBe(2);
      expect(content.findings.map(f => f.file)).toContain('src/api/auth.js');
      expect(content.findings.map(f => f.file)).toContain('lib/crypto.js');
    });
  });

  describe('import', () => {
    it('should import from LLM handoff file', () => {
      // First export
      syncManager.export({
        llm: 'claude',
        projectContext: { project: { name: 'test' } },
        message: 'Ready for review',
      });

      // Then import
      const result = syncManager.import({ llm: 'claude' });

      expect(result.success).toBe(true);
      expect(result.importedFrom).toBe('claude');
      expect(result.message).toBe('Ready for review');
    });

    it('should import from direct content', () => {
      const content = JSON.stringify({
        exportedBy: 'gemini',
        exportedAt: new Date().toISOString(),
        role: 'frontend',
        message: 'UI complete',
        project: { name: 'test' },
        github: {},
        session: null,
        findings: [],
        stats: {},
        _contentHash: 'abc123',
      });

      const result = syncManager.import({ content });

      expect(result.success).toBe(true);
      expect(result.importedFrom).toBe('gemini');
      expect(result.role).toBe('frontend');
    });

    it('should throw error when handoff file not found', () => {
      expect(() => syncManager.import({ llm: 'nonexistent' })).toThrow('No handoff file found');
    });
  });

  describe('merge', () => {
    it('should merge multiple LLM contexts', () => {
      // Export from Claude
      syncManager.export({
        llm: 'claude',
        findings: [{ type: 'bug', file: 'api.js', description: 'Bug 1' }],
      });

      // Export from Gemini
      syncManager.export({
        llm: 'gemini',
        findings: [{ type: 'bug', file: 'ui.js', description: 'Bug 2' }],
      });

      // Merge
      const result = syncManager.merge({ sources: ['claude', 'gemini'] });

      expect(result.success).toBe(true);
      expect(result.sourcesCount).toBe(2);
      expect(result.stats.findings).toBe(2);
    });

    it('should auto-detect available handoffs when no sources specified', () => {
      syncManager.export({ llm: 'claude' });
      syncManager.export({ llm: 'gemini' });

      const result = syncManager.merge({});

      expect(result.success).toBe(true);
      expect(result.sourcesCount).toBe(2);
    });

    it('should deduplicate findings by hash', () => {
      const sameFinding = { type: 'bug', file: 'api.js', description: 'Same bug' };

      syncManager.export({ llm: 'claude', findings: [sameFinding] });
      syncManager.export({ llm: 'gemini', findings: [sameFinding] });

      const result = syncManager.merge({});

      // Should only have 1 finding after deduplication
      expect(result.stats.findings).toBe(1);
    });

    it('should detect file conflicts', () => {
      const makeSession = (files) => ({
        getId: () => 'session_123',
        getState: () => 'running',
        getStats: () => ({}),
        getCurrentWork: () => null,
        getCompletedWork: () => [],
        getTrackingSummary: () => ({
          files: { created: [], modified: files, deleted: [] },
          issues: { created: [], fixed: [], skipped: [], failed: [] },
          findings: [],
          work: [],
        }),
        getEvents: () => [],
        session: { metadata: {}, context: {} },
      });

      // Both modify same file
      syncManager.export({ llm: 'claude', session: makeSession(['shared.js']) });
      syncManager.export({ llm: 'gemini', session: makeSession(['shared.js']) });

      const result = syncManager.merge({ strategy: 'manual' });

      expect(result.conflicts).not.toBeNull();
      expect(result.conflicts.some(c => c.type === 'file' && c.path === 'shared.js')).toBe(true);
    });

    it('should return error when no handoffs available', () => {
      const result = syncManager.merge({});

      expect(result.success).toBe(false);
      expect(result.error).toContain('No handoff files found');
    });
  });

  describe('status', () => {
    it('should return empty status when no exports exist', () => {
      const result = syncManager.status();

      expect(result.available).toHaveLength(0);
      expect(result.lastSync).toBeNull();
    });

    it('should show available handoffs', () => {
      syncManager.export({ llm: 'claude', message: 'Test 1' });
      syncManager.export({ llm: 'gemini', message: 'Test 2' });

      const result = syncManager.status();

      expect(result.available).toHaveLength(2);
      expect(result.available.map(a => a.llm)).toContain('claude');
      expect(result.available.map(a => a.llm)).toContain('gemini');
    });

    it('should show specific LLM status when requested', () => {
      syncManager.export({ llm: 'claude', role: 'backend' });

      const result = syncManager.status({ llm: 'claude' });

      expect(result.requested).toBeDefined();
      expect(result.requested.llm).toBe('claude');
      expect(result.requested.role).toBe('backend');
    });

    it('should sort by most recent first', () => {
      // Export in order
      syncManager.export({ llm: 'old' });

      // Wait a bit to ensure different timestamps
      const now = Date.now();
      while (Date.now() - now < 10) {
        // Small delay
      }

      syncManager.export({ llm: 'new' });

      const result = syncManager.status();

      expect(result.available[0].llm).toBe('new');
    });
  });

  describe('static methods', () => {
    it('should return role presets', () => {
      const presets = SyncManager.getRolePresets();

      expect(presets.frontend).toBeDefined();
      expect(presets.backend).toBeDefined();
      expect(presets.testing).toBeDefined();
      expect(presets.devops).toBeDefined();
    });

    it('should return known LLMs', () => {
      const llms = SyncManager.getKnownLLMs();

      expect(llms).toContain('claude');
      expect(llms).toContain('gemini');
      expect(llms).toContain('gpt4');
    });
  });
});
