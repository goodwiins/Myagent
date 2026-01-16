/**
 * Unit tests for ContextStore
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ContextStore } from '../../lib/context-store.js';
import { existsSync, rmSync, mkdirSync } from 'fs';
import { join } from 'path';

const TEST_BASE_PATH = '.goodflows-test/context';

describe('ContextStore', () => {
  let store;

  beforeEach(() => {
    // Clean up test directory
    if (existsSync(TEST_BASE_PATH)) {
      rmSync(TEST_BASE_PATH, { recursive: true });
    }
    store = new ContextStore({ basePath: TEST_BASE_PATH });
  });

  afterEach(() => {
    // Clean up after tests
    if (existsSync('.goodflows-test')) {
      rmSync('.goodflows-test', { recursive: true });
    }
  });

  describe('constructor', () => {
    it('should create directory structure', () => {
      expect(existsSync(TEST_BASE_PATH)).toBe(true);
      expect(existsSync(join(TEST_BASE_PATH, 'findings'))).toBe(true);
      expect(existsSync(join(TEST_BASE_PATH, 'patterns'))).toBe(true);
      expect(existsSync(join(TEST_BASE_PATH, 'sessions'))).toBe(true);
    });

    it('should initialize empty index', () => {
      expect(store.index).toBeDefined();
      expect(store.index.hashes).toEqual({});
      expect(store.index.stats.totalFindings).toBe(0);
    });
  });

  describe('addFinding', () => {
    it('should add a new finding', () => {
      const finding = {
        file: 'src/test.js',
        type: 'bug',
        description: 'Test bug description',
        lines: '10-15',
      };

      const result = store.addFinding(finding);

      expect(result.added).toBe(true);
      expect(result.duplicate).toBe(false);
      expect(result.hash).toHaveLength(16);
    });

    it('should detect duplicate findings', () => {
      const finding = {
        file: 'src/test.js',
        type: 'bug',
        description: 'Test bug description',
        lines: '10-15',
      };

      store.addFinding(finding);
      const result = store.addFinding(finding);

      expect(result.added).toBe(false);
      expect(result.duplicate).toBe(true);
    });

    it('should update stats correctly', () => {
      const finding1 = { file: 'a.js', type: 'bug', description: 'Bug 1' };
      const finding2 = { file: 'b.js', type: 'security', description: 'Security issue' };

      store.addFinding(finding1);
      store.addFinding(finding2);
      store.addFinding(finding1); // Duplicate

      expect(store.index.stats.totalFindings).toBe(3);
      expect(store.index.stats.uniqueFindings).toBe(2);
      expect(store.index.stats.duplicatesSkipped).toBe(1);
    });

    it('should normalize absolute paths to relative', () => {
      const finding = {
        file: join(process.cwd(), 'src', 'test.js'),
        type: 'bug',
        description: 'Test',
      };

      store.addFinding(finding);
      const results = store.query({ limit: 1 });

      // Normalize path separators for cross-platform compatibility
      const normalizedPath = results[0].file.replace(/\\/g, '/');
      expect(normalizedPath).toBe('src/test.js');
    });
  });

  describe('query', () => {
    beforeEach(() => {
      store.addFinding({ file: 'src/a.js', type: 'bug', description: 'Bug A' });
      store.addFinding({ file: 'src/b.js', type: 'security', description: 'Security B' });
      store.addFinding({ file: 'lib/c.js', type: 'bug', description: 'Bug C' });
    });

    it('should return all findings without filters', () => {
      const results = store.query();
      expect(results).toHaveLength(3);
    });

    it('should filter by type', () => {
      const results = store.query({ type: 'bug' });
      expect(results).toHaveLength(2);
      results.forEach(r => expect(r.type).toBe('bug'));
    });

    it('should filter by file substring', () => {
      const results = store.query({ file: 'src' });
      expect(results).toHaveLength(2);
    });

    it('should respect limit', () => {
      const results = store.query({ limit: 2 });
      expect(results).toHaveLength(2);
    });
  });

  describe('exists', () => {
    it('should return true for existing finding', () => {
      const finding = { file: 'test.js', type: 'bug', description: 'Test' };
      store.addFinding(finding);

      expect(store.exists(finding)).toBe(true);
    });

    it('should return false for non-existing finding', () => {
      const finding = { file: 'test.js', type: 'bug', description: 'Test' };
      expect(store.exists(finding)).toBe(false);
    });
  });

  describe('getAll', () => {
    it('should return all findings up to limit', () => {
      store.addFinding({ file: 'a.js', type: 'bug', description: 'A' });
      store.addFinding({ file: 'b.js', type: 'bug', description: 'B' });
      store.addFinding({ file: 'c.js', type: 'bug', description: 'C' });

      const results = store.getAll({ limit: 2 });
      expect(results).toHaveLength(2);
    });

    it('should use default limit of 1000', () => {
      const finding = { file: 'test.js', type: 'bug', description: 'Test' };
      store.addFinding(finding);

      const results = store.getAll();
      expect(results.length).toBeLessThanOrEqual(1000);
    });
  });

  describe('findSimilar', () => {
    beforeEach(() => {
      store.addFinding({ file: 'auth.js', type: 'security', description: 'Hardcoded API key in authentication module' });
      store.addFinding({ file: 'config.js', type: 'security', description: 'Hardcoded secret key in configuration' });
      store.addFinding({ file: 'utils.js', type: 'bug', description: 'Null pointer exception in utility function' });
    });

    it('should find similar findings based on description', () => {
      const results = store.findSimilar('Hardcoded API secret key', { threshold: 0.3 });
      expect(results.length).toBeGreaterThan(0);
      results.forEach(r => expect(r.similarity).toBeGreaterThanOrEqual(0.3));
    });

    it('should sort by similarity descending', () => {
      const results = store.findSimilar('Hardcoded API key', { threshold: 0.2 });
      for (let i = 1; i < results.length; i++) {
        expect(results[i - 1].similarity).toBeGreaterThanOrEqual(results[i].similarity);
      }
    });
  });

  describe('updateStatus', () => {
    it('should update finding status', () => {
      const result = store.addFinding({ file: 'test.js', type: 'bug', description: 'Test' });

      const updated = store.updateStatus(result.hash, 'fixed', { fixedBy: 'test-user' });

      expect(updated).toBe(true);

      const finding = store.getByHash(result.hash);
      expect(finding.status).toBe('fixed');
      expect(finding.fixedBy).toBe('test-user');
    });

    it('should return false for non-existent hash', () => {
      const updated = store.updateStatus('nonexistent', 'fixed');
      expect(updated).toBe(false);
    });
  });

  describe('linkToIssue', () => {
    it('should link finding to Linear issue', () => {
      const result = store.addFinding({ file: 'test.js', type: 'bug', description: 'Test' });

      store.linkToIssue(result.hash, 'GOO-123');

      expect(store.index.byIssue['GOO-123']).toBe(result.hash);

      const finding = store.getByIssueId('GOO-123');
      expect(finding).toBeDefined();
      expect(finding.issueId).toBe('GOO-123');
    });
  });

  describe('getStats', () => {
    it('should return accurate statistics', () => {
      store.addFinding({ file: 'a.js', type: 'bug', description: 'A' });
      store.addFinding({ file: 'b.js', type: 'security', description: 'B' });

      const stats = store.getStats();

      expect(stats.totalFindings).toBe(2);
      expect(stats.uniqueFindings).toBe(2);
      expect(stats.filesCovered).toBe(2);
      expect(stats.typesCovered).toBe(2);
    });
  });

  describe('exportToMarkdown', () => {
    it('should export findings as markdown', () => {
      store.addFinding({ file: 'test.js', type: 'bug', description: 'Test bug' });

      const markdown = store.exportToMarkdown();

      expect(markdown).toContain('# CodeRabbit Findings Log');
      expect(markdown).toContain('test.js');
      expect(markdown).toContain('bug');
    });
  });
});
