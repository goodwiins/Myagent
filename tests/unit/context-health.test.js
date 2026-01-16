/**
 * Unit tests for Context Health
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  getFileSizes,
  getFileLimits,
  calculateHealth,
  getStaleness,
  getCoverage,
  getHealthSummary,
  formatHealthReport,
  HEALTH_THRESHOLDS,
  STALENESS_THRESHOLDS,
} from '../../lib/context-health.js';
import { SIZE_LIMITS, CONTEXT_FILES } from '../../lib/context-files.js';
import { existsSync, mkdirSync, writeFileSync, rmSync, utimesSync } from 'fs';
import { join } from 'path';
import { randomUUID } from 'crypto';

describe('Context Health', () => {
  let testBasePath;

  beforeEach(() => {
    testBasePath = `.goodflows-test-${randomUUID().slice(0, 8)}`;
    mkdirSync(testBasePath, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(testBasePath)) {
      rmSync(testBasePath, { recursive: true, force: true });
    }
  });

  describe('getFileSizes', () => {
    it('returns sizes for existing files', async () => {
      writeFileSync(join(testBasePath, 'PROJECT.md'), '# Project\n\nDescription here.');
      writeFileSync(join(testBasePath, 'STATE.md'), '# State\n\nCurrent state.');

      const sizes = await getFileSizes({ basePath: testBasePath });

      expect(sizes.PROJECT.exists).toBe(true);
      expect(sizes.PROJECT.chars).toBeGreaterThan(0);
      expect(sizes.PROJECT.tokens).toBeGreaterThan(0);
      expect(sizes.PROJECT.lines).toBeGreaterThan(0);
      expect(sizes.STATE.exists).toBe(true);
    });

    it('handles missing files', async () => {
      const sizes = await getFileSizes({ basePath: testBasePath });

      expect(sizes.PROJECT.exists).toBe(false);
      expect(sizes.PROJECT.chars).toBe(0);
      expect(sizes.PROJECT.tokens).toBe(0);
    });

    it('calculates tokens correctly (4 chars per token)', async () => {
      // Create a file with exactly 40 characters
      writeFileSync(join(testBasePath, 'PROJECT.md'), 'x'.repeat(40));

      const sizes = await getFileSizes({ basePath: testBasePath });

      expect(sizes.PROJECT.chars).toBe(40);
      expect(sizes.PROJECT.tokens).toBe(10); // 40 chars / 4 = 10 tokens
    });
  });

  describe('getFileLimits', () => {
    it('returns all size limits', () => {
      const limits = getFileLimits();

      expect(limits).toEqual(SIZE_LIMITS);
      expect(limits.PROJECT).toBeDefined();
      expect(limits.STATE).toBeDefined();
      expect(limits.ROADMAP).toBeDefined();
      expect(limits.PLAN).toBeDefined();
      expect(limits.SUMMARY).toBeDefined();
      expect(limits.ISSUES).toBeDefined();
    });
  });

  describe('calculateHealth', () => {
    it('returns good status for files under 70% limit', async () => {
      // PROJECT limit is 2000 tokens. At 4 chars/token, that's 8000 chars.
      // 50% of that is 4000 chars.
      writeFileSync(join(testBasePath, 'PROJECT.md'), 'x'.repeat(4000));

      const health = await calculateHealth({ basePath: testBasePath });

      expect(health.PROJECT.status).toBe('good');
      expect(health.PROJECT.usedPercent).toBeLessThan(70);
    });

    it('returns warning status for files at 70-90% limit', async () => {
      // PROJECT limit is 2000 tokens (8000 chars). 80% is 6400 chars.
      writeFileSync(join(testBasePath, 'PROJECT.md'), 'x'.repeat(6400));

      const health = await calculateHealth({ basePath: testBasePath });

      expect(health.PROJECT.status).toBe('warning');
      expect(health.PROJECT.usedPercent).toBeGreaterThanOrEqual(70);
      expect(health.PROJECT.usedPercent).toBeLessThanOrEqual(90);
    });

    it('returns critical status for files over 90% limit', async () => {
      // PROJECT limit is 2000 tokens (8000 chars). 95% is 7600 chars.
      writeFileSync(join(testBasePath, 'PROJECT.md'), 'x'.repeat(7600));

      const health = await calculateHealth({ basePath: testBasePath });

      expect(health.PROJECT.status).toBe('critical');
      expect(health.PROJECT.usedPercent).toBeGreaterThanOrEqual(90);
    });

    it('returns missing status for non-existent files', async () => {
      const health = await calculateHealth({ basePath: testBasePath });

      expect(health.PROJECT.status).toBe('missing');
      expect(health.PROJECT.exists).toBe(false);
    });

    it('includes remaining tokens', async () => {
      writeFileSync(join(testBasePath, 'PROJECT.md'), 'x'.repeat(4000)); // ~1000 tokens

      const health = await calculateHealth({ basePath: testBasePath });

      expect(health.PROJECT.remainingTokens).toBe(1000); // 2000 - 1000
    });
  });

  describe('getStaleness', () => {
    it('returns fresh status for recently updated files', async () => {
      writeFileSync(join(testBasePath, 'PROJECT.md'), '# Project');

      const staleness = await getStaleness({ basePath: testBasePath });

      expect(staleness.PROJECT.exists).toBe(true);
      expect(staleness.PROJECT.daysSinceUpdate).toBe(0);
      expect(staleness.PROJECT.status).toBe('fresh');
      expect(staleness.PROJECT.lastModified).toBeDefined();
    });

    it('returns stale status for old files', async () => {
      const filePath = join(testBasePath, 'PROJECT.md');
      writeFileSync(filePath, '# Project');

      // Set modification time to 45 days ago
      const oldDate = new Date(Date.now() - 45 * 24 * 60 * 60 * 1000);
      utimesSync(filePath, oldDate, oldDate);

      const staleness = await getStaleness({ basePath: testBasePath });

      expect(staleness.PROJECT.daysSinceUpdate).toBeGreaterThanOrEqual(45);
      expect(staleness.PROJECT.status).toBe('stale');
    });

    it('returns missing status for non-existent files', async () => {
      const staleness = await getStaleness({ basePath: testBasePath });

      expect(staleness.PROJECT.exists).toBe(false);
      expect(staleness.PROJECT.status).toBe('missing');
      expect(staleness.PROJECT.lastModified).toBeNull();
    });
  });

  describe('getCoverage', () => {
    it('calculates coverage correctly', async () => {
      writeFileSync(join(testBasePath, 'PROJECT.md'), '# Project');
      writeFileSync(join(testBasePath, 'STATE.md'), '# State');
      writeFileSync(join(testBasePath, 'PLAN.md'), '# Plan');

      const coverage = await getCoverage({ basePath: testBasePath });

      expect(coverage.totalFiles).toBe(Object.keys(CONTEXT_FILES).length);
      expect(coverage.existingFiles).toBe(3);
      expect(coverage.missingFiles).toBe(coverage.totalFiles - 3);
      expect(coverage.coveragePercent).toBe(Math.round((3 / coverage.totalFiles) * 100));
    });

    it('returns file status map', async () => {
      writeFileSync(join(testBasePath, 'PROJECT.md'), '# Project');

      const coverage = await getCoverage({ basePath: testBasePath });

      expect(coverage.files.PROJECT).toBe(true);
      expect(coverage.files.STATE).toBe(false);
    });

    it('handles empty directory', async () => {
      const coverage = await getCoverage({ basePath: testBasePath });

      expect(coverage.existingFiles).toBe(0);
      expect(coverage.coveragePercent).toBe(0);
    });
  });

  describe('getHealthSummary', () => {
    it('returns complete health summary', async () => {
      writeFileSync(join(testBasePath, 'PROJECT.md'), '# Project');
      writeFileSync(join(testBasePath, 'STATE.md'), '# State');

      const summary = await getHealthSummary({ basePath: testBasePath });

      expect(summary.overallScore).toBeDefined();
      expect(summary.status).toBeDefined();
      expect(summary.summary).toBeDefined();
      expect(summary.coverage).toBeDefined();
      expect(summary.files).toBeDefined();
      expect(summary.suggestions).toBeDefined();
      expect(summary.generatedAt).toBeDefined();
    });

    it('calculates overall score', async () => {
      // Create all files for perfect coverage
      for (const [type, filename] of Object.entries(CONTEXT_FILES)) {
        writeFileSync(join(testBasePath, filename), `# ${type}`);
      }

      const summary = await getHealthSummary({ basePath: testBasePath });

      // With all files present and small, score should be high
      expect(summary.overallScore).toBeGreaterThanOrEqual(80);
      expect(summary.status).toBe('healthy');
    });

    it('penalizes missing files', async () => {
      // Only create one file
      writeFileSync(join(testBasePath, 'PROJECT.md'), '# Project');

      const summary = await getHealthSummary({ basePath: testBasePath });

      // Missing 5 files = -75 penalty, so score should be around 25
      expect(summary.overallScore).toBeLessThan(50);
      expect(summary.summary.missingFiles).toBe(5);
    });

    it('generates suggestions for missing files', async () => {
      const summary = await getHealthSummary({ basePath: testBasePath });

      expect(summary.suggestions.some(s => s.includes('Create missing files'))).toBe(true);
    });

    it('includes staleness info in file details', async () => {
      writeFileSync(join(testBasePath, 'PROJECT.md'), '# Project');

      const summary = await getHealthSummary({ basePath: testBasePath });

      expect(summary.files.PROJECT.staleness).toBeDefined();
      expect(summary.files.PROJECT.staleness.status).toBe('fresh');
    });
  });

  describe('formatHealthReport', () => {
    it('formats health summary for display', async () => {
      writeFileSync(join(testBasePath, 'PROJECT.md'), '# Project');

      const summary = await getHealthSummary({ basePath: testBasePath });
      const report = formatHealthReport(summary);

      expect(report).toContain('Context Health Report');
      expect(report).toContain('Overall Score:');
      expect(report).toContain('PROJECT:');
    });

    it('includes progress bars', async () => {
      writeFileSync(join(testBasePath, 'PROJECT.md'), '# Project');

      const summary = await getHealthSummary({ basePath: testBasePath });
      const report = formatHealthReport(summary);

      expect(report).toMatch(/[█░]+/); // Progress bar characters
    });

    it('includes suggestions', async () => {
      const summary = await getHealthSummary({ basePath: testBasePath });
      const report = formatHealthReport(summary);

      expect(report).toContain('Suggestions:');
      expect(report).toContain('Create missing files');
    });

    it('works without colors', async () => {
      writeFileSync(join(testBasePath, 'PROJECT.md'), '# Project');

      const summary = await getHealthSummary({ basePath: testBasePath });
      const report = formatHealthReport(summary, { color: false });

      // Should not contain ANSI escape codes
      expect(report).not.toContain('\x1b[');
    });
  });

  describe('Constants', () => {
    it('exports HEALTH_THRESHOLDS', () => {
      expect(HEALTH_THRESHOLDS.GOOD).toBe(0.7);
      expect(HEALTH_THRESHOLDS.WARNING).toBe(0.7);
      expect(HEALTH_THRESHOLDS.CRITICAL).toBe(0.9);
    });

    it('exports STALENESS_THRESHOLDS', () => {
      expect(STALENESS_THRESHOLDS.FRESH).toBe(1);
      expect(STALENESS_THRESHOLDS.RECENT).toBe(7);
      expect(STALENESS_THRESHOLDS.STALE).toBe(30);
      expect(STALENESS_THRESHOLDS.VERY_STALE).toBe(90);
    });
  });
});
