/**
 * SyncManager - Cross-CLI synchronization for multi-LLM collaboration
 *
 * Enables different LLMs (Claude, Gemini, GPT-4, etc.) to work on the same
 * codebase with shared context via file-based synchronization.
 *
 * @module lib/sync-manager
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from 'fs';
import { join, basename } from 'path';
import { createHash } from 'crypto';

/**
 * Simple glob pattern matcher
 * Supports: *, **, ?
 * @param {string} pattern - Glob pattern
 * @param {string} str - String to match
 * @returns {boolean}
 */
function matchGlob(pattern, str) {
  // Escape regex special characters except * and ?
  let regexPattern = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    // Handle ** (match any path including /)
    .replace(/\*\*/g, '{{GLOBSTAR}}')
    // Handle * (match anything except /)
    .replace(/\*/g, '[^/]*')
    // Handle ?
    .replace(/\?/g, '[^/]')
    // Restore globstar
    .replace(/\{\{GLOBSTAR\}\}/g, '.*');

  const regex = new RegExp(`^${regexPattern}$`);
  return regex.test(str);
}

/**
 * Default sync configuration
 */
const DEFAULT_CONFIG = {
  syncDir: '.goodflows/sync',
  handoffPrefix: 'handoff-',
  sharedStateFile: 'shared-state.json',
  conflictsFile: 'conflicts.json',
  maxFindingsPerExport: 50,
  mergeStrategy: 'latest-wins', // 'latest-wins' | 'manual' | 'theirs' | 'ours'
};

/**
 * Supported LLM identifiers
 */
const KNOWN_LLMS = ['claude', 'gemini', 'gpt4', 'copilot', 'cursor', 'windsurf', 'other'];

/**
 * Role presets for filtering
 */
const ROLE_PRESETS = {
  frontend: {
    includeFiles: ['src/components/**', 'src/pages/**', 'src/styles/**', 'src/hooks/**', '*.css', '*.scss'],
    excludeFiles: ['src/api/**', 'src/server/**', 'src/db/**', 'lib/**'],
  },
  backend: {
    includeFiles: ['src/api/**', 'src/server/**', 'src/db/**', 'lib/**', 'bin/**'],
    excludeFiles: ['src/components/**', 'src/pages/**', 'src/styles/**'],
  },
  testing: {
    includeFiles: ['tests/**', '**/*.test.*', '**/*.spec.*', 'vitest.config.*', 'jest.config.*'],
    excludeFiles: [],
  },
  devops: {
    includeFiles: ['Dockerfile*', 'docker-compose*', '.github/**', 'scripts/**', '*.yaml', '*.yml'],
    excludeFiles: ['src/**'],
  },
};

/**
 * SyncManager class for cross-CLI synchronization
 */
export class SyncManager {
  /**
   * @param {Object} options - Configuration options
   * @param {string} [options.basePath] - Base path for .goodflows directory
   * @param {Object} [options.config] - Override default config
   */
  constructor(options = {}) {
    this.basePath = options.basePath || process.cwd();
    this.config = { ...DEFAULT_CONFIG, ...options.config };
    this.syncPath = join(this.basePath, this.config.syncDir);
    this._ensureSyncDir();
  }

  /**
   * Ensure sync directory exists
   * @private
   */
  _ensureSyncDir() {
    if (!existsSync(this.syncPath)) {
      mkdirSync(this.syncPath, { recursive: true });
    }
  }

  /**
   * Generate content hash for deduplication
   * @private
   */
  _hash(content) {
    return createHash('sha256').update(JSON.stringify(content)).digest('hex').slice(0, 12);
  }

  /**
   * Get handoff file path for an LLM
   * @private
   */
  _getHandoffPath(llm) {
    return join(this.syncPath, `${this.config.handoffPrefix}${llm}.json`);
  }

  /**
   * Get shared state file path
   * @private
   */
  _getSharedStatePath() {
    return join(this.syncPath, this.config.sharedStateFile);
  }

  /**
   * Get conflicts file path
   * @private
   */
  _getConflictsPath() {
    return join(this.syncPath, this.config.conflictsFile);
  }

  /**
   * Filter tracked files by role
   * @private
   */
  _filterFilesByRole(files, role, customFilters = {}) {
    if (!role && !customFilters.includeFiles && !customFilters.excludeFiles) {
      return files;
    }

    const preset = ROLE_PRESETS[role] || {};
    const includePatterns = customFilters.includeFiles || preset.includeFiles || [];
    const excludePatterns = customFilters.excludeFiles || preset.excludeFiles || [];

    return files.filter(file => {
      const filePath = typeof file === 'string' ? file : file.path;

      // If include patterns specified, file must match at least one
      if (includePatterns.length > 0) {
        const matchesInclude = includePatterns.some(pattern => matchGlob(pattern, filePath));
        if (!matchesInclude) return false;
      }

      // If exclude patterns specified, file must not match any
      if (excludePatterns.length > 0) {
        const matchesExclude = excludePatterns.some(pattern => matchGlob(pattern, filePath));
        if (matchesExclude) return false;
      }

      return true;
    });
  }

  /**
   * Filter findings by role
   * @private
   */
  _filterFindingsByRole(findings, role, customFilters = {}) {
    if (!role && !customFilters.includeFiles && !customFilters.excludeFiles) {
      return findings;
    }

    return findings.filter(finding => {
      if (!finding.file) return true; // Keep findings without file reference
      return this._filterFilesByRole([finding.file], role, customFilters).length > 0;
    });
  }

  /**
   * Export context for another LLM to import
   *
   * @param {Object} options - Export options
   * @param {string} options.llm - LLM identifier (claude, gemini, gpt4, etc.)
   * @param {Object} [options.session] - Session data from SessionContextManager
   * @param {Array} [options.findings] - Findings from context store
   * @param {Object} [options.projectContext] - Project context info
   * @param {string} [options.role] - Role preset (frontend, backend, testing, devops)
   * @param {Array} [options.includeFiles] - Custom include glob patterns
   * @param {Array} [options.excludeFiles] - Custom exclude glob patterns
   * @param {string} [options.message] - Message for the receiving LLM
   * @returns {Object} Export result with file path
   */
  export(options) {
    const {
      llm,
      session,
      findings = [],
      projectContext = {},
      role,
      includeFiles,
      excludeFiles,
      message,
    } = options;

    if (!llm) {
      throw new Error('LLM identifier is required for export');
    }

    const normalizedLlm = llm.toLowerCase();
    const customFilters = { includeFiles, excludeFiles };

    // Build session data with role filtering
    let sessionData = null;
    if (session) {
      const tracking = session.getTrackingSummary?.() || session.tracking || {};
      const filteredTracking = {
        files: {
          created: this._filterFilesByRole(tracking.files?.created || [], role, customFilters),
          modified: this._filterFilesByRole(tracking.files?.modified || [], role, customFilters),
          deleted: this._filterFilesByRole(tracking.files?.deleted || [], role, customFilters),
        },
        issues: tracking.issues || { created: [], fixed: [], skipped: [], failed: [] },
        findings: this._filterFindingsByRole(tracking.findings || [], role, customFilters),
        work: tracking.work || [],
        currentWork: tracking.currentWork || null,
      };

      sessionData = {
        id: session.getId?.() || session.id,
        state: session.getState?.() || session.state,
        metadata: session.session?.metadata || session.metadata || {},
        stats: session.getStats?.() || session.stats || {},
        currentWork: session.getCurrentWork?.() || tracking.currentWork,
        completedWork: session.getCompletedWork?.() || tracking.work || [],
        tracking: filteredTracking,
        recentEvents: (session.getEvents?.() || session.events || []).slice(-20),
        context: session.session?.context || session.context || {},
      };
    }

    // Filter findings by role
    const filteredFindings = this._filterFindingsByRole(
      findings.slice(0, this.config.maxFindingsPerExport),
      role,
      customFilters
    );

    const handoff = {
      version: '1.0.0',
      exportedAt: new Date().toISOString(),
      exportedBy: normalizedLlm,
      role: role || 'full',
      filters: {
        includeFiles: includeFiles || ROLE_PRESETS[role]?.includeFiles || [],
        excludeFiles: excludeFiles || ROLE_PRESETS[role]?.excludeFiles || [],
      },
      message: message || null,
      project: {
        name: projectContext.project?.name || projectContext.name,
        version: projectContext.project?.version || projectContext.version,
        description: projectContext.project?.description || projectContext.description,
      },
      github: projectContext.github || {},
      session: sessionData,
      findings: filteredFindings.map(f => ({
        type: f.type,
        file: f.file,
        description: f.description,
        status: f.status,
        issueId: f.issueId,
        lines: f.lines,
        severity: f.severity,
        _hash: f._hash || this._hash(f),
      })),
      stats: {
        totalFindings: filteredFindings.length,
        trackedFiles: sessionData?.tracking?.files
          ? (sessionData.tracking.files.created?.length || 0) +
            (sessionData.tracking.files.modified?.length || 0)
          : 0,
      },
      _contentHash: null, // Will be set after
    };

    // Calculate content hash for change detection
    handoff._contentHash = this._hash(handoff);

    // Write to LLM-specific file
    const handoffPath = this._getHandoffPath(normalizedLlm);
    writeFileSync(handoffPath, JSON.stringify(handoff, null, 2));

    // Update shared state
    this._updateSharedState(normalizedLlm, handoff);

    return {
      success: true,
      path: handoffPath,
      llm: normalizedLlm,
      role: role || 'full',
      contentHash: handoff._contentHash,
      stats: handoff.stats,
      message: `Exported to ${handoffPath}`,
    };
  }

  /**
   * Import context from another LLM
   *
   * @param {Object} options - Import options
   * @param {string} options.llm - LLM to import from
   * @param {Object} [options.content] - Direct content (if not reading from file)
   * @returns {Object} Imported data
   */
  import(options) {
    const { llm, content } = options;

    let handoff;
    if (content) {
      handoff = typeof content === 'string' ? JSON.parse(content) : content;
    } else if (llm) {
      const handoffPath = this._getHandoffPath(llm.toLowerCase());
      if (!existsSync(handoffPath)) {
        throw new Error(`No handoff file found for ${llm} at ${handoffPath}`);
      }
      handoff = JSON.parse(readFileSync(handoffPath, 'utf-8'));
    } else {
      throw new Error('Either llm or content must be provided');
    }

    return {
      success: true,
      importedFrom: handoff.exportedBy,
      exportedAt: handoff.exportedAt,
      role: handoff.role,
      message: handoff.message,
      project: handoff.project,
      github: handoff.github,
      session: handoff.session,
      findings: handoff.findings,
      stats: handoff.stats,
      contentHash: handoff._contentHash,
    };
  }

  /**
   * Merge contexts from multiple LLMs
   *
   * @param {Object} options - Merge options
   * @param {Array<string>} options.sources - LLMs to merge from
   * @param {string} [options.strategy] - Merge strategy
   * @returns {Object} Merged context
   */
  merge(options) {
    const { sources = [], strategy = this.config.mergeStrategy } = options;

    if (sources.length === 0) {
      // Auto-detect available handoffs
      const files = readdirSync(this.syncPath)
        .filter(f => f.startsWith(this.config.handoffPrefix) && f.endsWith('.json'));
      sources.push(...files.map(f =>
        f.replace(this.config.handoffPrefix, '').replace('.json', '')
      ));
    }

    if (sources.length === 0) {
      return { success: false, error: 'No handoff files found to merge' };
    }

    const handoffs = sources.map(llm => {
      try {
        return this.import({ llm });
      } catch (e) {
        return null;
      }
    }).filter(Boolean);

    if (handoffs.length === 0) {
      return { success: false, error: 'No valid handoff files found' };
    }

    // Sort by export time (latest first for latest-wins strategy)
    handoffs.sort((a, b) => new Date(b.exportedAt) - new Date(a.exportedAt));

    const conflicts = [];
    const merged = {
      mergedAt: new Date().toISOString(),
      sources: handoffs.map(h => ({ llm: h.importedFrom, exportedAt: h.exportedAt, role: h.role })),
      strategy,
      project: handoffs[0].project,
      github: handoffs[0].github,
      sessions: [],
      findings: [],
      trackedFiles: {
        created: [],
        modified: [],
        deleted: [],
      },
    };

    // Merge sessions
    const sessionMap = new Map();
    for (const handoff of handoffs) {
      if (handoff.session) {
        const existing = sessionMap.get(handoff.session.id);
        if (existing) {
          // Conflict: same session modified by multiple LLMs
          if (strategy === 'latest-wins') {
            // Keep newer one
            if (new Date(handoff.exportedAt) > new Date(existing._exportedAt)) {
              sessionMap.set(handoff.session.id, { ...handoff.session, _exportedAt: handoff.exportedAt });
            }
          } else {
            conflicts.push({
              type: 'session',
              id: handoff.session.id,
              sources: [existing._source, handoff.importedFrom],
            });
          }
        } else {
          sessionMap.set(handoff.session.id, {
            ...handoff.session,
            _exportedAt: handoff.exportedAt,
            _source: handoff.importedFrom,
          });
        }
      }
    }
    merged.sessions = Array.from(sessionMap.values());

    // Merge findings (deduplicate by hash)
    const findingMap = new Map();
    for (const handoff of handoffs) {
      for (const finding of handoff.findings || []) {
        const hash = finding._hash || this._hash(finding);
        if (!findingMap.has(hash)) {
          findingMap.set(hash, { ...finding, _source: handoff.importedFrom });
        }
      }
    }
    merged.findings = Array.from(findingMap.values());

    // Merge tracked files
    const fileTracker = { created: new Set(), modified: new Set(), deleted: new Set() };
    for (const handoff of handoffs) {
      const tracking = handoff.session?.tracking?.files || {};
      for (const file of tracking.created || []) {
        const path = typeof file === 'string' ? file : file.path;
        fileTracker.created.add(path);
      }
      for (const file of tracking.modified || []) {
        const path = typeof file === 'string' ? file : file.path;
        // Check for conflict: same file modified by multiple LLMs
        if (fileTracker.modified.has(path)) {
          conflicts.push({
            type: 'file',
            path,
            action: 'modified',
            sources: [handoff.importedFrom],
          });
        }
        fileTracker.modified.add(path);
      }
      for (const file of tracking.deleted || []) {
        const path = typeof file === 'string' ? file : file.path;
        fileTracker.deleted.add(path);
      }
    }
    merged.trackedFiles = {
      created: Array.from(fileTracker.created),
      modified: Array.from(fileTracker.modified),
      deleted: Array.from(fileTracker.deleted),
    };

    // Save conflicts if any
    if (conflicts.length > 0) {
      writeFileSync(this._getConflictsPath(), JSON.stringify(conflicts, null, 2));
    }

    // Save merged state
    const sharedStatePath = this._getSharedStatePath();
    writeFileSync(sharedStatePath, JSON.stringify(merged, null, 2));

    return {
      success: true,
      path: sharedStatePath,
      sourcesCount: handoffs.length,
      sources: merged.sources,
      stats: {
        sessions: merged.sessions.length,
        findings: merged.findings.length,
        filesCreated: merged.trackedFiles.created.length,
        filesModified: merged.trackedFiles.modified.length,
        filesDeleted: merged.trackedFiles.deleted.length,
      },
      conflicts: conflicts.length > 0 ? conflicts : null,
      conflictsPath: conflicts.length > 0 ? this._getConflictsPath() : null,
    };
  }

  /**
   * Get sync status - what's changed since last sync
   *
   * @param {Object} [options] - Status options
   * @param {string} [options.llm] - Check specific LLM's status
   * @returns {Object} Sync status
   */
  status(options = {}) {
    const { llm } = options;

    const available = [];
    const files = readdirSync(this.syncPath)
      .filter(f => f.startsWith(this.config.handoffPrefix) && f.endsWith('.json'));

    for (const file of files) {
      const llmName = file.replace(this.config.handoffPrefix, '').replace('.json', '');
      const filePath = join(this.syncPath, file);
      try {
        const content = JSON.parse(readFileSync(filePath, 'utf-8'));
        available.push({
          llm: llmName,
          exportedAt: content.exportedAt,
          role: content.role,
          message: content.message,
          contentHash: content._contentHash,
          stats: content.stats,
        });
      } catch (e) {
        available.push({
          llm: llmName,
          error: 'Failed to parse handoff file',
        });
      }
    }

    // Sort by most recent
    available.sort((a, b) => {
      if (!a.exportedAt) return 1;
      if (!b.exportedAt) return -1;
      return new Date(b.exportedAt) - new Date(a.exportedAt);
    });

    // Check for shared state
    let sharedState = null;
    const sharedStatePath = this._getSharedStatePath();
    if (existsSync(sharedStatePath)) {
      try {
        const content = JSON.parse(readFileSync(sharedStatePath, 'utf-8'));
        sharedState = {
          mergedAt: content.mergedAt,
          sources: content.sources,
          stats: {
            sessions: content.sessions?.length || 0,
            findings: content.findings?.length || 0,
          },
        };
      } catch (e) {
        sharedState = { error: 'Failed to parse shared state' };
      }
    }

    // Check for conflicts
    let conflicts = null;
    const conflictsPath = this._getConflictsPath();
    if (existsSync(conflictsPath)) {
      try {
        conflicts = JSON.parse(readFileSync(conflictsPath, 'utf-8'));
      } catch (e) {
        conflicts = { error: 'Failed to parse conflicts file' };
      }
    }

    const result = {
      syncPath: this.syncPath,
      available,
      sharedState,
      conflicts,
      lastSync: available.length > 0 ? available[0].exportedAt : null,
    };

    // If specific LLM requested, include detailed comparison
    if (llm) {
      const llmStatus = available.find(a => a.llm === llm.toLowerCase());
      result.requested = llmStatus || { llm, found: false };
    }

    return result;
  }

  /**
   * Update shared state with new export
   * @private
   */
  _updateSharedState(llm, handoff) {
    const sharedStatePath = this._getSharedStatePath();
    let sharedState = {
      lastUpdated: new Date().toISOString(),
      exports: {},
    };

    if (existsSync(sharedStatePath)) {
      try {
        sharedState = JSON.parse(readFileSync(sharedStatePath, 'utf-8'));
      } catch (e) {
        // Reset if corrupted
      }
    }

    sharedState.lastUpdated = new Date().toISOString();
    sharedState.exports = sharedState.exports || {};
    sharedState.exports[llm] = {
      exportedAt: handoff.exportedAt,
      role: handoff.role,
      contentHash: handoff._contentHash,
      stats: handoff.stats,
    };

    writeFileSync(sharedStatePath, JSON.stringify(sharedState, null, 2));
  }

  /**
   * Get available role presets
   * @returns {Object} Role presets
   */
  static getRolePresets() {
    return ROLE_PRESETS;
  }

  /**
   * Get known LLM identifiers
   * @returns {Array<string>} Known LLMs
   */
  static getKnownLLMs() {
    return KNOWN_LLMS;
  }
}

export default SyncManager;
