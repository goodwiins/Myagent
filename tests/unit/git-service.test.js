/**
 * Tests for git-service.js
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { join } from 'path';
import { existsSync, rmSync, mkdirSync, writeFileSync } from 'fs';
import { randomUUID } from 'crypto';
import { execSync } from 'child_process';
import {
  GitService,
  createGitService,
  DEFAULT_TIMEOUT_MS,
} from '../../lib/git-service.js';

describe('GitService Constants', () => {
  describe('DEFAULT_TIMEOUT_MS', () => {
    it('should be 30 seconds', () => {
      expect(DEFAULT_TIMEOUT_MS).toBe(30000);
    });
  });
});

describe('GitService', () => {
  let gitService;
  let testDir;

  beforeEach(() => {
    // Create unique temp directory for each test
    testDir = join('/tmp', `git-service-test-${randomUUID()}`);
    mkdirSync(testDir, { recursive: true });

    // Initialize git repo
    execSync('git init', { cwd: testDir, stdio: 'pipe' });
    execSync('git config user.email "test@test.com"', { cwd: testDir, stdio: 'pipe' });
    execSync('git config user.name "Test User"', { cwd: testDir, stdio: 'pipe' });

    gitService = new GitService({ cwd: testDir });
  });

  afterEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe('constructor', () => {
    it('should create service with default options', () => {
      const service = new GitService();
      expect(service.cwd).toBe(process.cwd());
      expect(service.timeout).toBe(DEFAULT_TIMEOUT_MS);
      expect(service.dryRun).toBe(false);
    });

    it('should create service with custom options', () => {
      const service = new GitService({
        cwd: '/custom/path',
        timeout: 60000,
        dryRun: true,
      });
      expect(service.cwd).toBe('/custom/path');
      expect(service.timeout).toBe(60000);
      expect(service.dryRun).toBe(true);
    });
  });

  describe('isRepo', () => {
    it('should return true for git repo', async () => {
      const result = await gitService.isRepo();
      expect(result).toBe(true);
    });

    it('should return false for non-git directory', async () => {
      const nonGitDir = join('/tmp', `non-git-${randomUUID()}`);
      mkdirSync(nonGitDir, { recursive: true });

      const service = new GitService({ cwd: nonGitDir });
      const result = await service.isRepo();

      expect(result).toBe(false);

      rmSync(nonGitDir, { recursive: true, force: true });
    });
  });

  describe('stageFiles', () => {
    it('should stage existing files', async () => {
      // Create a file
      const filePath = join(testDir, 'test.txt');
      writeFileSync(filePath, 'test content');

      const result = await gitService.stageFiles([filePath]);

      expect(result.success).toBe(true);
      expect(result.staged).toContain(filePath);
      expect(result.errors).toHaveLength(0);
    });

    it('should report errors for non-existent files', async () => {
      const result = await gitService.stageFiles(['/non/existent/file.txt']);

      expect(result.success).toBe(false);
      expect(result.staged).toHaveLength(0);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('should stage multiple files', async () => {
      const file1 = join(testDir, 'file1.txt');
      const file2 = join(testDir, 'file2.txt');
      writeFileSync(file1, 'content 1');
      writeFileSync(file2, 'content 2');

      const result = await gitService.stageFiles([file1, file2]);

      expect(result.success).toBe(true);
      expect(result.staged).toHaveLength(2);
    });

    it('should handle mixed existing and non-existing files', async () => {
      const existingFile = join(testDir, 'exists.txt');
      writeFileSync(existingFile, 'content');

      const result = await gitService.stageFiles([
        existingFile,
        '/non/existent/file.txt',
      ]);

      expect(result.success).toBe(false);
      expect(result.staged).toContain(existingFile);
      expect(result.errors.length).toBeGreaterThan(0);
    });
  });

  describe('hasStagedChanges', () => {
    it('should return false when no staged changes', async () => {
      const result = await gitService.hasStagedChanges();
      expect(result.hasChanges).toBe(false);
      expect(result.files).toHaveLength(0);
    });

    it('should return true after staging files', async () => {
      const filePath = join(testDir, 'staged.txt');
      writeFileSync(filePath, 'staged content');
      await gitService.stageFiles([filePath]);

      const result = await gitService.hasStagedChanges();

      expect(result.hasChanges).toBe(true);
      expect(result.files.length).toBeGreaterThan(0);
    });
  });

  describe('commit', () => {
    it('should create a commit with staged changes', async () => {
      const filePath = join(testDir, 'commit.txt');
      writeFileSync(filePath, 'commit content');
      await gitService.stageFiles([filePath]);

      const result = await gitService.commit('test: add commit file');

      expect(result.success).toBe(true);
      expect(result.commitHash).toBeDefined();
      expect(result.commitHash.length).toBeGreaterThan(0);
    });

    it('should fail with invalid message', async () => {
      const result = await gitService.commit('');

      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid commit message');
    });

    it('should fail when no staged changes', async () => {
      const result = await gitService.commit('test: empty commit');

      expect(result.success).toBe(false);
    });

    it('should add co-author when provided', async () => {
      const filePath = join(testDir, 'coauthor.txt');
      writeFileSync(filePath, 'coauthor content');
      await gitService.stageFiles([filePath]);

      const result = await gitService.commit('test: co-authored commit', {
        coAuthor: 'Claude <noreply@anthropic.com>',
      });

      expect(result.success).toBe(true);

      // Verify co-author in commit message
      const log = execSync('git log -1 --format=%B', { cwd: testDir, encoding: 'utf-8' });
      expect(log).toContain('Co-Authored-By: Claude');
    });
  });

  describe('status', () => {
    it('should return empty status for clean repo', async () => {
      const status = await gitService.status();

      expect(status.staged).toHaveLength(0);
      expect(status.unstaged).toHaveLength(0);
      expect(status.untracked).toHaveLength(0);
    });

    it('should show untracked files', async () => {
      writeFileSync(join(testDir, 'untracked.txt'), 'content');

      const status = await gitService.status();

      expect(status.untracked.length).toBeGreaterThan(0);
    });

    it('should show staged files', async () => {
      const filePath = join(testDir, 'staged.txt');
      writeFileSync(filePath, 'content');
      await gitService.stageFiles([filePath]);

      const status = await gitService.status();

      expect(status.staged.length).toBeGreaterThan(0);
    });
  });

  describe('getCurrentBranch', () => {
    it('should return current branch name', async () => {
      // Need at least one commit to have a proper branch
      const filePath = join(testDir, 'branch.txt');
      writeFileSync(filePath, 'branch content');
      await gitService.stageFiles([filePath]);
      await gitService.commit('test: initial commit');

      const branch = await gitService.getCurrentBranch();

      // Default branch is typically 'master' or 'main'
      expect(['master', 'main']).toContain(branch);
    });
  });

  describe('getHead', () => {
    it('should return commit hash after commit', async () => {
      const filePath = join(testDir, 'head.txt');
      writeFileSync(filePath, 'head content');
      await gitService.stageFiles([filePath]);
      await gitService.commit('test: add head file');

      const hash = await gitService.getHead();

      expect(hash).toBeDefined();
      expect(hash.length).toBe(7); // Short hash
    });

    it('should return full hash when short=false', async () => {
      const filePath = join(testDir, 'fullhash.txt');
      writeFileSync(filePath, 'full hash content');
      await gitService.stageFiles([filePath]);
      await gitService.commit('test: add full hash file');

      const hash = await gitService.getHead(false);

      expect(hash.length).toBe(40); // Full hash
    });
  });

  describe('unstageFiles', () => {
    it('should unstage staged files', async () => {
      const filePath = join(testDir, 'unstage.txt');
      writeFileSync(filePath, 'unstage content');
      await gitService.stageFiles([filePath]);

      // Verify staged
      let status = await gitService.hasStagedChanges();
      expect(status.hasChanges).toBe(true);

      // Unstage
      const result = await gitService.unstageFiles([filePath]);

      expect(result.success).toBe(true);
      expect(result.unstaged).toContain(filePath);

      // Verify unstaged
      status = await gitService.hasStagedChanges();
      expect(status.hasChanges).toBe(false);
    });
  });

  describe('getRecentCommits', () => {
    it('should return recent commits', async () => {
      // Create some commits
      const file1 = join(testDir, 'commit1.txt');
      writeFileSync(file1, 'content1');
      await gitService.stageFiles([file1]);
      await gitService.commit('test: first commit');

      const file2 = join(testDir, 'commit2.txt');
      writeFileSync(file2, 'content2');
      await gitService.stageFiles([file2]);
      await gitService.commit('test: second commit');

      const commits = await gitService.getRecentCommits(2);

      expect(commits.length).toBe(2);
      expect(commits[0].message).toBe('test: second commit');
      expect(commits[1].message).toBe('test: first commit');
      expect(commits[0].hash).toBeDefined();
      expect(commits[0].date).toBeDefined();
    });
  });

  describe('hasUncommittedChanges', () => {
    it('should return false for clean repo', async () => {
      const result = await gitService.hasUncommittedChanges();
      expect(result).toBe(false);
    });

    it('should return true when untracked files exist', async () => {
      writeFileSync(join(testDir, 'untracked.txt'), 'content');

      const result = await gitService.hasUncommittedChanges();
      expect(result).toBe(true);
    });

    it('should return true when staged files exist', async () => {
      const filePath = join(testDir, 'staged.txt');
      writeFileSync(filePath, 'content');
      await gitService.stageFiles([filePath]);

      const result = await gitService.hasUncommittedChanges();
      expect(result).toBe(true);
    });
  });

  describe('stageAndCommit', () => {
    it('should stage and commit files in one operation', async () => {
      const filePath = join(testDir, 'combined.txt');
      writeFileSync(filePath, 'combined content');

      const result = await gitService.stageAndCommit(
        [filePath],
        'test: combined operation',
      );

      expect(result.success).toBe(true);
      expect(result.commitHash).toBeDefined();
    });

    it('should fail when files do not exist', async () => {
      const result = await gitService.stageAndCommit(
        ['/non/existent/file.txt'],
        'test: should fail',
      );

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('should fail when no changes to commit', async () => {
      // Create and commit a file
      const filePath = join(testDir, 'nochange.txt');
      writeFileSync(filePath, 'content');
      await gitService.stageAndCommit([filePath], 'test: first commit');

      // Try to commit the same file again (no changes)
      const result = await gitService.stageAndCommit(
        [filePath],
        'test: should fail',
      );

      expect(result.success).toBe(false);
    });
  });

  describe('dryRun mode', () => {
    it('should not execute real git commands in dryRun mode', async () => {
      const dryRunService = new GitService({ cwd: testDir, dryRun: true });

      const filePath = join(testDir, 'dryrun.txt');
      writeFileSync(filePath, 'dry run content');

      // In dry run, staging should "succeed" but not actually stage
      const stageResult = await dryRunService.stageFiles([filePath]);

      // Should report success (file exists)
      expect(stageResult.staged).toContain(filePath);

      // Verify file was not actually staged (using non-dry-run service)
      const status = await gitService.hasStagedChanges();
      expect(status.hasChanges).toBe(false);
    });

    it('should return dry run message in _exec', async () => {
      const dryRunService = new GitService({ cwd: testDir, dryRun: true });

      // Call _exec directly to test dry run output
      const result = await dryRunService._exec(['status']);

      expect(result.stdout).toContain('[DRY RUN]');
      expect(result.exitCode).toBe(0);
    });
  });
});

describe('createGitService', () => {
  it('should create a GitService instance', () => {
    const service = createGitService();
    expect(service).toBeInstanceOf(GitService);
  });

  it('should pass options to GitService', () => {
    const service = createGitService({ timeout: 60000 });
    expect(service.timeout).toBe(60000);
  });
});
