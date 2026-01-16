/**
 * GoodFlows Git Service
 *
 * Safe git operations using spawn with argument arrays to prevent
 * command injection vulnerabilities. Never uses shell interpolation.
 *
 * @module goodflows/lib/git-service
 */

import { spawn } from 'node:child_process';

/**
 * Default timeout for git operations (30 seconds)
 */
export const DEFAULT_TIMEOUT_MS = 30000;

/**
 * GitService - Safe git operations without shell injection risks
 *
 * IMPORTANT: This class NEVER uses shell: true or string interpolation.
 * All arguments are passed as arrays to prevent command injection.
 */
export class GitService {
  constructor(options = {}) {
    this.cwd = options.cwd || process.cwd();
    this.timeout = options.timeout || DEFAULT_TIMEOUT_MS;
    this.dryRun = options.dryRun || false;
  }

  /**
   * Execute a git command safely
   *
   * @param {string[]} args - Git command arguments (NOT including 'git')
   * @param {object} options - Execution options
   * @returns {Promise<{stdout: string, stderr: string, exitCode: number}>}
   */
  async _exec(args, options = {}) {
    const timeout = options.timeout || this.timeout;

    return new Promise((resolve, reject) => {
      if (this.dryRun) {
        resolve({
          stdout: `[DRY RUN] git ${args.join(' ')}`,
          stderr: '',
          exitCode: 0,
        });
        return;
      }

      const child = spawn('git', args, {
        cwd: this.cwd,
        // CRITICAL: Never set shell: true
        shell: false,
        // Capture output
        stdio: ['pipe', 'pipe', 'pipe'],
        // Set timeout
        timeout,
      });

      let stdout = '';
      let stderr = '';

      child.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      child.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      child.on('close', (exitCode) => {
        resolve({ stdout, stderr, exitCode: exitCode || 0 });
      });

      child.on('error', (error) => {
        reject(error);
      });
    });
  }

  /**
   * Stage files for commit
   *
   * IMPORTANT: Stages files individually, NEVER uses 'git add .'
   *
   * GOO-143: Removed TOCTOU race condition by letting git handle file existence.
   * GOO-146: Batch staging for performance (groups of 50 files).
   *
   * @param {string[]} files - File paths to stage
   * @returns {Promise<{success: boolean, staged: string[], errors: string[]}>}
   */
  async stageFiles(files) {
    const staged = [];
    const errors = [];
    const BATCH_SIZE = 50;

    // Process files in batches for performance (GOO-146)
    for (let i = 0; i < files.length; i += BATCH_SIZE) {
      const batch = files.slice(i, i + BATCH_SIZE);

      // For batches, try batch first then fall back to individual on any failure
      if (batch.length > 1) {
        try {
          // Use '--' to separate file paths from options (prevents path injection)
          // Let git handle file existence - no TOCTOU race condition (GOO-143)
          const result = await this._exec(['add', '--', ...batch]);

          if (result.exitCode === 0) {
            staged.push(...batch);
            continue; // Batch succeeded, move to next batch
          }
        } catch {
          // Batch failed, fall through to individual staging
        }
      }

      // Stage individually (either batch of 1, or fallback from failed batch)
      for (const file of batch) {
        try {
          const singleResult = await this._exec(['add', '--', file]);
          if (singleResult.exitCode === 0) {
            staged.push(file);
          } else {
            errors.push(`Failed to stage ${file}: ${singleResult.stderr || 'Unknown error'}`);
          }
        } catch (singleError) {
          errors.push(`Error staging ${file}: ${singleError.message}`);
        }
      }
    }

    return {
      success: errors.length === 0,
      staged,
      errors,
    };
  }

  /**
   * Check if there are staged changes
   *
   * @returns {Promise<{hasChanges: boolean, files: string[]}>}
   */
  async hasStagedChanges() {
    const result = await this._exec(['diff', '--cached', '--name-only']);

    const files = result.stdout.trim().split('\n').filter(f => f.length > 0);

    return {
      hasChanges: files.length > 0,
      files,
    };
  }

  /**
   * Create a commit with the staged changes
   *
   * @param {string} message - Commit message
   * @param {object} options - Commit options
   * @param {string} options.coAuthor - Co-author for the commit
   * @returns {Promise<{success: boolean, commitHash?: string, error?: string}>}
   */
  async commit(message, options = {}) {
    // Validate message
    if (!message || typeof message !== 'string') {
      return { success: false, error: 'Invalid commit message' };
    }

    // Build commit args
    const args = ['commit', '-m', message];

    // Add co-author if provided (as a separate -m argument)
    if (options.coAuthor) {
      args.push('-m', `Co-Authored-By: ${options.coAuthor}`);
    }

    try {
      const result = await this._exec(args);

      if (result.exitCode !== 0) {
        return {
          success: false,
          error: result.stderr || 'Commit failed',
        };
      }

      // Get commit hash
      const hashResult = await this._exec(['rev-parse', '--short', 'HEAD']);
      const commitHash = hashResult.stdout.trim();

      return {
        success: true,
        commitHash,
        message,
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Get git status
   *
   * @returns {Promise<{staged: string[], unstaged: string[], untracked: string[]}>}
   */
  async status() {
    const result = await this._exec(['status', '--porcelain']);

    const lines = result.stdout.trim().split('\n').filter(l => l.length > 0);

    const staged = [];
    const unstaged = [];
    const untracked = [];

    for (const line of lines) {
      const status = line.substring(0, 2);
      const file = line.substring(3);

      if (status[0] !== ' ' && status[0] !== '?') {
        staged.push(file);
      }
      if (status[1] !== ' ' && status[1] !== '?') {
        unstaged.push(file);
      }
      if (status[0] === '?') {
        untracked.push(file);
      }
    }

    return { staged, unstaged, untracked };
  }

  /**
   * Get the current branch name
   *
   * @returns {Promise<string>}
   */
  async getCurrentBranch() {
    const result = await this._exec(['rev-parse', '--abbrev-ref', 'HEAD']);
    return result.stdout.trim();
  }

  /**
   * Get the commit hash for HEAD
   *
   * @param {boolean} short - Return short hash (default: true)
   * @returns {Promise<string>}
   */
  async getHead(short = true) {
    const args = short
      ? ['rev-parse', '--short', 'HEAD']
      : ['rev-parse', 'HEAD'];

    const result = await this._exec(args);
    return result.stdout.trim();
  }

  /**
   * Check if a path is in a git repository
   *
   * @returns {Promise<boolean>}
   */
  async isRepo() {
    try {
      const result = await this._exec(['rev-parse', '--git-dir']);
      return result.exitCode === 0;
    } catch {
      return false;
    }
  }

  /**
   * Unstage files
   *
   * @param {string[]} files - Files to unstage
   * @returns {Promise<{success: boolean, unstaged: string[], errors: string[]}>}
   */
  async unstageFiles(files) {
    const unstaged = [];
    const errors = [];

    for (const file of files) {
      try {
        const result = await this._exec(['reset', 'HEAD', '--', file]);

        if (result.exitCode === 0) {
          unstaged.push(file);
        } else {
          errors.push(`Failed to unstage ${file}: ${result.stderr}`);
        }
      } catch (error) {
        errors.push(`Error unstaging ${file}: ${error.message}`);
      }
    }

    return {
      success: errors.length === 0,
      unstaged,
      errors,
    };
  }

  /**
   * Get recent commits
   *
   * @param {number} count - Number of commits to return (default: 5)
   * @returns {Promise<{hash: string, message: string, date: string}[]>}
   */
  async getRecentCommits(count = 5) {
    const result = await this._exec([
      'log',
      `-${count}`,
      '--format=%h|%s|%ci',
    ]);

    const lines = result.stdout.trim().split('\n').filter(l => l.length > 0);

    return lines.map(line => {
      const [hash, message, date] = line.split('|');
      return { hash, message, date };
    });
  }

  /**
   * Check if there are uncommitted changes
   *
   * @returns {Promise<boolean>}
   */
  async hasUncommittedChanges() {
    const status = await this.status();
    return status.staged.length > 0 ||
           status.unstaged.length > 0 ||
           status.untracked.length > 0;
  }

  /**
   * Stage and commit files atomically
   *
   * This is a convenience method that stages files and commits them
   * in a single operation. Returns early if staging fails.
   *
   * @param {string[]} files - Files to stage and commit
   * @param {string} message - Commit message
   * @param {object} options - Commit options
   * @returns {Promise<{success: boolean, commitHash?: string, error?: string}>}
   */
  async stageAndCommit(files, message, options = {}) {
    // Stage files
    const stageResult = await this.stageFiles(files);

    if (stageResult.staged.length === 0) {
      return {
        success: false,
        error: stageResult.errors.length > 0
          ? stageResult.errors.join('; ')
          : 'No files to stage',
      };
    }

    // Check if anything was staged
    const hasChanges = await this.hasStagedChanges();

    if (!hasChanges.hasChanges) {
      return {
        success: false,
        error: 'No changes staged',
      };
    }

    // Commit
    return this.commit(message, options);
  }
}

/**
 * Create a GitService instance
 *
 * @param {object} options - Service options
 * @returns {GitService}
 */
export function createGitService(options = {}) {
  return new GitService(options);
}

export default {
  GitService,
  createGitService,
  DEFAULT_TIMEOUT_MS,
};
