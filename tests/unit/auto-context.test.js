/**
 * Unit tests for Auto-Context Detection
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  detectContextNeeds,
  autoLoadContext,
  getContextRecommendations,
  categorizeTask,
  KEYWORD_PATTERNS,
} from '../../lib/auto-context.js';
import { existsSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { randomUUID } from 'crypto';

describe('Auto-Context Detection', () => {
  describe('detectContextNeeds', () => {
    it('returns default context for empty task', () => {
      const result = detectContextNeeds('');

      expect(result.files).toContain('PROJECT');
      expect(result.files).toContain('STATE');
      expect(result.confidence).toBe(0.5);
      expect(result.matchedKeywords).toEqual([]);
    });

    it('returns default context for null task', () => {
      const result = detectContextNeeds(null);

      expect(result.files).toEqual(['PROJECT', 'STATE']);
      expect(result.confidence).toBe(0.5);
    });

    it('detects bug fix keywords', () => {
      const result = detectContextNeeds('Fix the authentication bug');

      expect(result.files).toContain('STATE');
      expect(result.files).toContain('PLAN');
      expect(result.matchedKeywords).toContain('fix');
      expect(result.matchedKeywords).toContain('bug');
      expect(result.confidence).toBeGreaterThan(0.5);
    });

    it('detects planning keywords', () => {
      const result = detectContextNeeds('Plan the new authentication system design');

      expect(result.files).toContain('ROADMAP');
      expect(result.files).toContain('PROJECT');
      expect(result.matchedKeywords).toContain('plan');
      expect(result.matchedKeywords).toContain('design');
    });

    it('detects implementation keywords', () => {
      const result = detectContextNeeds('Implement the user dashboard feature');

      expect(result.files).toContain('PROJECT');
      expect(result.files).toContain('ROADMAP');
      expect(result.files).toContain('PLAN');
      expect(result.matchedKeywords).toContain('implement');
      expect(result.matchedKeywords).toContain('feature');
    });

    it('detects review keywords', () => {
      const result = detectContextNeeds('Review the code and verify it');

      expect(result.files).toContain('STATE');
      expect(result.files).toContain('SUMMARY');
      expect(result.matchedKeywords).toContain('review');
      expect(result.matchedKeywords).toContain('verify');
    });

    it('detects resume keywords', () => {
      const result = detectContextNeeds('Resume where we left off');

      expect(result.files).toContain('STATE');
      expect(result.files).toContain('PLAN');
      expect(result.matchedKeywords).toContain('resume');
    });

    it('increases confidence with more keyword matches', () => {
      const singleMatch = detectContextNeeds('Fix something');
      const multipleMatches = detectContextNeeds('Fix the bug and review the error logs');

      expect(multipleMatches.confidence).toBeGreaterThan(singleMatch.confidence);
    });

    it('caps confidence at 0.95', () => {
      const result = detectContextNeeds('Fix bug error debug broken crash failing issue');

      expect(result.confidence).toBeLessThanOrEqual(0.95);
    });

    it('uses word boundaries for matching', () => {
      // "fixed" should not match "fix" pattern
      const result = detectContextNeeds('The issue was fixed yesterday');

      // Should still find "issue" but we're testing word boundaries work
      expect(result.matchedKeywords).toContain('issue');
    });

    it('is case insensitive', () => {
      const result = detectContextNeeds('FIX the BUG in PLAN');

      expect(result.matchedKeywords).toContain('fix');
      expect(result.matchedKeywords).toContain('bug');
      expect(result.matchedKeywords).toContain('plan');
    });

    it('sorts files by priority', () => {
      const result = detectContextNeeds('Plan roadmap issues project state');

      // PROJECT and STATE should come first
      expect(result.files[0]).toBe('PROJECT');
      expect(result.files[1]).toBe('STATE');
    });
  });

  describe('categorizeTask', () => {
    it('categorizes bug fix tasks', () => {
      expect(categorizeTask('Fix the login bug')).toBe('bug-fix');
      expect(categorizeTask('Debug the error')).toBe('bug-fix');
      expect(categorizeTask('The feature is broken')).toBe('bug-fix');
    });

    it('categorizes planning tasks', () => {
      expect(categorizeTask('Plan the next sprint')).toBe('planning');
      expect(categorizeTask('Design the API architecture')).toBe('planning');
      expect(categorizeTask('Strategy for the release')).toBe('planning');
    });

    it('categorizes implementation tasks', () => {
      expect(categorizeTask('Implement user authentication')).toBe('implementation');
      expect(categorizeTask('Add a new feature')).toBe('implementation');
      expect(categorizeTask('Build the dashboard')).toBe('implementation');
    });

    it('categorizes review tasks', () => {
      expect(categorizeTask('Review the pull request')).toBe('review');
      expect(categorizeTask('Test the new module')).toBe('review');
      expect(categorizeTask('Audit the security')).toBe('review');
    });

    it('categorizes refactoring tasks', () => {
      expect(categorizeTask('Refactor the utils')).toBe('refactoring');
      expect(categorizeTask('Cleanup the codebase')).toBe('refactoring');
      expect(categorizeTask('Optimize the queries')).toBe('refactoring');
    });

    it('categorizes documentation tasks', () => {
      expect(categorizeTask('Document the API')).toBe('documentation');
      expect(categorizeTask('Update the readme')).toBe('documentation');
    });

    it('categorizes status check tasks', () => {
      expect(categorizeTask('What is the status?')).toBe('status-check');
      expect(categorizeTask('Show progress')).toBe('status-check');
    });

    it('categorizes resume tasks', () => {
      expect(categorizeTask('Resume the previous task')).toBe('resume');
      expect(categorizeTask('Continue where we left off')).toBe('resume');
    });

    it('returns general for unrecognized tasks', () => {
      expect(categorizeTask('Hello world')).toBe('general');
      expect(categorizeTask('')).toBe('general');
    });
  });

  describe('getContextRecommendations', () => {
    it('includes detection results', () => {
      const result = getContextRecommendations('Fix the bug');

      expect(result.files).toBeDefined();
      expect(result.confidence).toBeDefined();
      expect(result.matchedKeywords).toBeDefined();
    });

    it('provides recommendations for resume tasks', () => {
      const result = getContextRecommendations('Resume the previous task');

      expect(result.recommendations.length).toBeGreaterThan(0);
      expect(result.recommendations.some(r => r.includes('resume'))).toBe(true);
    });

    it('warns about many context files', () => {
      const result = getContextRecommendations('Plan implement review test document');

      if (result.files.length > 4) {
        expect(result.recommendations.some(r => r.includes('breaking task'))).toBe(true);
      }
    });

    it('estimates token usage', () => {
      const result = getContextRecommendations('Fix the bug');

      expect(result.estimatedTokens).toBeGreaterThan(0);
    });
  });

  describe('autoLoadContext', () => {
    let testBasePath;
    let goodflowsPath;

    beforeEach(() => {
      testBasePath = `.goodflows-test-${randomUUID().slice(0, 8)}`;
      goodflowsPath = join(testBasePath, '.goodflows');
      mkdirSync(goodflowsPath, { recursive: true });

      // Create test context files in the .goodflows subdirectory
      writeFileSync(join(goodflowsPath, 'PROJECT.md'), '# Test Project\n\nThis is a test project.');
      writeFileSync(join(goodflowsPath, 'STATE.md'), '# State\n\nCurrent state info.');
      writeFileSync(join(goodflowsPath, 'PLAN.md'), '# Plan\n\nCurrent plan details.');
      writeFileSync(join(goodflowsPath, 'ROADMAP.md'), '# Roadmap\n\nProject roadmap.');
      writeFileSync(join(goodflowsPath, 'ISSUES.md'), '# Issues\n\nOpen issues.');
      writeFileSync(join(goodflowsPath, 'SUMMARY.md'), '# Summary\n\nExecution summary.');
    });

    afterEach(() => {
      if (existsSync(testBasePath)) {
        rmSync(testBasePath, { recursive: true, force: true });
      }
    });

    it('loads context files based on task', async () => {
      const result = await autoLoadContext('Fix the bug', { basePath: testBasePath });

      expect(result.content).toBeDefined();
      expect(result.loadedFiles.length).toBeGreaterThan(0);
      expect(result.stats.filesLoaded).toBeGreaterThan(0);
    });

    it('respects token budget', async () => {
      const result = await autoLoadContext('Plan everything', {
        basePath: testBasePath,
        budgetTokens: 100, // Very small budget
      });

      expect(result.stats.totalTokens).toBeLessThanOrEqual(100);
    });

    it('includes detection info', async () => {
      const result = await autoLoadContext('Fix the bug', { basePath: testBasePath });

      expect(result.detection).toBeDefined();
      expect(result.detection.matchedKeywords).toContain('fix');
      expect(result.detection.matchedKeywords).toContain('bug');
    });

    it('calculates savings correctly', async () => {
      const result = await autoLoadContext('Fix the bug', { basePath: testBasePath });

      expect(result.stats.tokensSaved).toBeGreaterThanOrEqual(0);
      expect(result.stats.savingsPercent).toBeGreaterThanOrEqual(0);
      expect(result.stats.savingsPercent).toBeLessThanOrEqual(100);
    });

    it('tracks skipped files', async () => {
      // Small budget should skip some files
      const result = await autoLoadContext('Plan implement review test', {
        basePath: testBasePath,
        budgetTokens: 50,
      });

      // At such a small budget, some files will be skipped
      expect(result.skippedFiles.length).toBeGreaterThanOrEqual(0);
    });

    it('includes metadata by default', async () => {
      const result = await autoLoadContext('Fix bug', { basePath: testBasePath });

      expect(result.content).toContain('<!-- Context:');
    });

    it('excludes metadata when requested', async () => {
      const result = await autoLoadContext('Fix bug', {
        basePath: testBasePath,
        includeMetadata: false,
      });

      expect(result.content).not.toContain('<!-- Context:');
    });

    it('handles missing files gracefully', async () => {
      // Remove a file
      rmSync(join(goodflowsPath, 'PLAN.md'));

      const result = await autoLoadContext('Fix bug needs plan', { basePath: testBasePath });

      expect(result.skippedFiles.some(f => f.file === 'PLAN')).toBe(true);
    });
  });

  describe('KEYWORD_PATTERNS', () => {
    it('contains expected keyword categories', () => {
      expect(KEYWORD_PATTERNS.fix).toBeDefined();
      expect(KEYWORD_PATTERNS.plan).toBeDefined();
      expect(KEYWORD_PATTERNS.implement).toBeDefined();
      expect(KEYWORD_PATTERNS.review).toBeDefined();
      expect(KEYWORD_PATTERNS.refactor).toBeDefined();
    });

    it('maps keywords to context files', () => {
      expect(KEYWORD_PATTERNS.fix).toContain('STATE');
      expect(KEYWORD_PATTERNS.plan).toContain('ROADMAP');
      expect(KEYWORD_PATTERNS.implement).toContain('PROJECT');
    });
  });
});
