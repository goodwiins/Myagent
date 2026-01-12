/**
 * ContextStore - Enhanced memory storage for GoodFlows agents
 *
 * Replaces flat markdown files with indexed JSONL storage featuring:
 * - Content-hash deduplication
 * - Partitioned storage by date
 * - Filtered reads for agent-specific context
 * - Pattern tracking with success rates
 */

import { createHash } from 'crypto';
import { existsSync, mkdirSync, appendFileSync, readFileSync, writeFileSync, readdirSync } from 'fs';
import { join, relative, isAbsolute } from 'path';

/**
 * Generate content hash for deduplication
 * @param {object} item - Item to hash
 * @returns {string} SHA-256 hash prefix (16 chars)
 */
function contentHash(item) {
  let filePath = item.file;
  if (filePath && isAbsolute(filePath)) {
    filePath = relative(process.cwd(), filePath);
  }

  const normalized = JSON.stringify({
    file: filePath,
    type: item.type,
    description: item.description?.toLowerCase().trim(),
    lines: item.lines,
  });
  return createHash('sha256').update(normalized).digest('hex').slice(0, 16);
}

/**
 * Get current date partition key (YYYY-MM)
 * @returns {string}
 */
function getPartitionKey() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

/**
 * Enhanced context storage with indexing and deduplication
 */
export class ContextStore {
  /**
   * @param {object} options
   * @param {string} options.basePath - Base path for context storage
   * @param {object} options.ttl - TTL settings for different data types
   * @param {boolean} options.enableIndex - Whether to maintain indexes
   */
  constructor(options = {}) {
    this.basePath = options.basePath || '.goodflows/context';
    this.ttl = {
      findings: options.ttl?.findings || '30d',
      patterns: options.ttl?.patterns || 'forever',
      sessions: options.ttl?.sessions || '7d',
    };
    this.enableIndex = options.enableIndex !== false;

    // Initialize directories
    this._initDirs();

    // Load index
    this.index = this._loadIndex();
  }

  /**
   * Initialize directory structure
   */
  _initDirs() {
    const dirs = [
      this.basePath,
      join(this.basePath, 'findings'),
      join(this.basePath, 'patterns'),
      join(this.basePath, 'sessions'),
    ];

    for (const dir of dirs) {
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }
    }
  }

  /**
   * Load or create the main index
   * @returns {object}
   */
  _loadIndex() {
    const indexPath = join(this.basePath, 'index.json');

    if (existsSync(indexPath)) {
      try {
        return JSON.parse(readFileSync(indexPath, 'utf-8'));
      } catch {
        // Corrupted index - recreate from scratch
        return this._createEmptyIndex();
      }
    }

    return this._createEmptyIndex();
  }

  /**
   * Create empty index structure
   */
  _createEmptyIndex() {
    return {
      version: '1.0.0',
      created: new Date().toISOString(),
      updated: new Date().toISOString(),
      hashes: {},          // hash -> { partition, offset, type }
      byFile: {},          // file -> [hash, ...]
      byType: {},          // type -> [hash, ...]
      byIssue: {},         // issueId -> hash
      stats: {
        totalFindings: 0,
        uniqueFindings: 0,
        duplicatesSkipped: 0,
      },
    };
  }

  /**
   * Save index to disk
   */
  _saveIndex() {
    if (!this.enableIndex) return;

    this.index.updated = new Date().toISOString();
    const indexPath = join(this.basePath, 'index.json');
    writeFileSync(indexPath, JSON.stringify(this.index, null, 2));
  }

  /**
   * Check if a finding already exists (by content hash)
   * @param {object} finding
   * @returns {boolean}
   */
  exists(finding) {
    const hash = contentHash(finding);
    return hash in this.index.hashes;
  }

  /**
   * Calculate trigram similarity between two strings
   * @param {string} str1
   * @param {string} str2
   * @returns {number} Similarity score 0-1
   */
  _trigramSimilarity(str1, str2) {
    const getTrigrams = (s) => {
      const normalized = s.toLowerCase().trim();
      const trigrams = new Set();
      for (let i = 0; i <= normalized.length - 3; i++) {
        trigrams.add(normalized.slice(i, i + 3));
      }
      return trigrams;
    };

    const t1 = getTrigrams(str1);
    const t2 = getTrigrams(str2);

    if (t1.size === 0 || t2.size === 0) return 0;

    let intersection = 0;
    for (const t of t1) {
      if (t2.has(t)) intersection++;
    }

    const union = t1.size + t2.size - intersection;
    return union > 0 ? intersection / union : 0;
  }

  /**
   * Find similar findings using trigram similarity
   * @param {string} description - Description to match against
   * @param {object} options
   * @param {number} options.threshold - Similarity threshold 0-1 (default: 0.85)
   * @param {string} options.file - Filter by file path
   * @param {string} options.type - Filter by finding type
   * @returns {object[]} Similar findings with similarity scores
   */
  findSimilar(description, options = {}) {
    const threshold = options.threshold || 0.85;
    const results = [];

    // Get candidates - filter by file/type if provided for efficiency
    const candidates = this.query({
      file: options.file,
      type: options.type,
      limit: 500,
    });

    for (const finding of candidates) {
      if (!finding.description) continue;

      const similarity = this._trigramSimilarity(description, finding.description);

      if (similarity >= threshold) {
        results.push({
          ...finding,
          similarity,
        });
      }
    }

    // Sort by similarity descending
    results.sort((a, b) => b.similarity - a.similarity);

    return results;
  }

  /**
   * Get a finding by its hash
   * @param {string} hash
   * @returns {object|null}
   */
  getByHash(hash) {
    const location = this.index.hashes[hash];
    if (!location) return null;

    const filePath = join(this.basePath, 'findings', `${location.partition}.jsonl`);
    if (!existsSync(filePath)) return null;

    const lines = readFileSync(filePath, 'utf-8').split('\n').filter(Boolean);
    for (const line of lines) {
      try {
        const item = JSON.parse(line);
        if (item._hash === hash) return item;
      } catch {
        // Skip malformed lines
        continue;
      }
    }

    return null;
  }

  /**
   * Add a new finding with deduplication
   * @param {object} finding
   * @returns {{ added: boolean, hash: string, duplicate: boolean }}
   */
  addFinding(finding) {
    // Normalize file path to relative
    if (finding.file && isAbsolute(finding.file)) {
      finding.file = relative(process.cwd(), finding.file);
    }

    const hash = contentHash(finding);

    this.index.stats.totalFindings++;

    // Check for duplicate
    if (this.index.hashes[hash]) {
      this.index.stats.duplicatesSkipped++;
      this._saveIndex();
      return { added: false, hash, duplicate: true };
    }

    // Prepare record
    const partition = getPartitionKey();
    const record = {
      _hash: hash,
      _timestamp: new Date().toISOString(),
      _partition: partition,
      ...finding,
    };

    // Append to partition file
    const filePath = join(this.basePath, 'findings', `${partition}.jsonl`);
    appendFileSync(filePath, JSON.stringify(record) + '\n');

    // Update index
    this.index.hashes[hash] = { partition, type: finding.type };
    this.index.stats.uniqueFindings++;

    // Index by file
    if (finding.file) {
      if (!this.index.byFile[finding.file]) {
        this.index.byFile[finding.file] = [];
      }
      this.index.byFile[finding.file].push(hash);
    }

    // Index by type
    if (finding.type) {
      if (!this.index.byType[finding.type]) {
        this.index.byType[finding.type] = [];
      }
      this.index.byType[finding.type].push(hash);
    }

    // Index by issue ID
    if (finding.issueId) {
      this.index.byIssue[finding.issueId] = hash;
    }

    this._saveIndex();

    return { added: true, hash, duplicate: false };
  }

  /**
   * Bulk add findings with deduplication
   * @param {object[]} findings
   * @returns {{ added: number, skipped: number, hashes: string[] }}
   */
  addFindings(findings) {
    let added = 0;
    let skipped = 0;
    const hashes = [];

    for (const finding of findings) {
      const result = this.addFinding(finding);
      hashes.push(result.hash);
      if (result.added) {
        added++;
      } else {
        skipped++;
      }
    }

    return { added, skipped, hashes };
  }

  /**
   * Query findings with filters
   * @param {object} filters
   * @param {string} filters.file - Filter by file path (substring match)
   * @param {string} filters.type - Filter by finding type
   * @param {string} filters.status - Filter by status
   * @param {string} filters.since - ISO date string, return items after this date
   * @param {number} filters.limit - Max items to return
   * @returns {object[]}
   */
  query(filters = {}) {
    const results = [];
    const limit = filters.limit || 100;

    // Determine which hashes to check
    let candidateHashes;

    if (filters.file && this.index.byFile[filters.file]) {
      candidateHashes = new Set(this.index.byFile[filters.file]);
    } else if (filters.type && this.index.byType[filters.type]) {
      candidateHashes = new Set(this.index.byType[filters.type]);
    } else {
      candidateHashes = new Set(Object.keys(this.index.hashes));
    }

    // Narrow down by file substring if partial match
    if (filters.file && !this.index.byFile[filters.file]) {
      const matchingFiles = Object.keys(this.index.byFile)
        .filter(f => f.includes(filters.file));
      candidateHashes = new Set();
      for (const f of matchingFiles) {
        for (const h of this.index.byFile[f]) {
          candidateHashes.add(h);
        }
      }
    }

    // Load and filter candidates
    const partitions = new Set();
    for (const hash of candidateHashes) {
      const loc = this.index.hashes[hash];
      if (loc) partitions.add(loc.partition);
    }

    for (const partition of partitions) {
      const filePath = join(this.basePath, 'findings', `${partition}.jsonl`);
      if (!existsSync(filePath)) continue;

      const lines = readFileSync(filePath, 'utf-8').split('\n').filter(Boolean);

      for (const line of lines) {
        if (results.length >= limit) break;

        try {
          const item = JSON.parse(line);

          // Apply filters
          if (!candidateHashes.has(item._hash)) continue;
          if (filters.status && item.status !== filters.status) continue;
          if (filters.since && item._timestamp < filters.since) continue;

          results.push(item);
        } catch {
          // Skip malformed lines
          continue;
        }
      }

      if (results.length >= limit) break;
    }

    return results;
  }

  /**
   * Get findings for a specific file (optimized read)
   * @param {string} filePath
   * @param {object} options
   * @returns {object[]}
   */
  getForFile(filePath, options = {}) {
    return this.query({
      file: filePath,
      status: options.excludeResolved ? undefined : options.status,
      limit: options.limit || 50,
    }).filter(f => !options.excludeResolved || f.status !== 'resolved');
  }

  /**
   * Get relevant context for an agent
   * @param {string} agentType - 'orchestrator' | 'issue-creator' | 'auto-fixer'
   * @param {object} context - Current context (file, type, etc.)
   * @returns {object}
   */
  getAgentContext(agentType, context = {}) {
    switch (agentType) {
      case 'orchestrator':
        return {
          activeIssues: this.query({ status: 'open', limit: 20 }),
          pendingFixes: this.query({ status: 'pending_fix', limit: 10 }),
          recentRuns: this._getRecentRuns(5),
        };

      case 'issue-creator':
        return {
          duplicateIndex: this._getDuplicateCheckData(),
          labelMappings: this._getLabelMappings(),
          recentIssues: this.query({ limit: 30 }),
        };

      case 'auto-fixer':
        return {
          patterns: this.getPatterns({ limit: 20 }),
          similarFixes: context.file ? this._getSimilarFixes(context.file) : [],
          successRates: this._getPatternSuccessRates(),
        };

      default:
        return {
          findings: this.query({ limit: 50 }),
        };
    }
  }

  /**
   * Get duplicate check data (hash index for fast lookups)
   */
  _getDuplicateCheckData() {
    return {
      hashes: Object.keys(this.index.hashes),
      byFile: this.index.byFile,
    };
  }

  /**
   * Get label mappings from config or defaults
   */
  _getLabelMappings() {
    return {
      critical_security: ['security', 'critical'],
      potential_issue: ['bug'],
      refactor_suggestion: ['improvement'],
      performance: ['performance'],
      documentation: ['docs'],
    };
  }

  /**
   * Get recent run logs
   * @param {number} limit
   */
  _getRecentRuns(limit = 5) {
    const runsPath = join(this.basePath, 'sessions');
    if (!existsSync(runsPath)) return [];

    const files = readdirSync(runsPath)
      .filter(f => f.endsWith('.json'))
      .sort()
      .reverse()
      .slice(0, limit);

    return files.map(f => {
      try {
        return JSON.parse(readFileSync(join(runsPath, f), 'utf-8'));
      } catch {
        // Skip corrupted run files
        return null;
      }
    }).filter(Boolean);
  }

  /**
   * Get similar fixes for a file
   * @param {string} filePath
   */
  _getSimilarFixes(filePath) {
    const patterns = this.getPatterns({ file: filePath });
    return patterns.filter(p => p.successRate >= 0.8);
  }

  /**
   * Get pattern success rates
   */
  _getPatternSuccessRates() {
    const patterns = this.getPatterns({ limit: 100 });
    const rates = {};

    for (const p of patterns) {
      rates[p.patternId] = p.successRate || 0;
    }

    return rates;
  }

  /**
   * Update finding status
   * @param {string} hash - Finding hash
   * @param {string} status - New status
   * @param {object} metadata - Additional metadata
   */
  updateStatus(hash, status, metadata = {}) {
    const location = this.index.hashes[hash];
    if (!location) return false;

    const filePath = join(this.basePath, 'findings', `${location.partition}.jsonl`);
    if (!existsSync(filePath)) return false;

    const lines = readFileSync(filePath, 'utf-8').split('\n');
    let updated = false;

    const newLines = lines.map(line => {
      if (!line) return line;
      try {
        const item = JSON.parse(line);
        if (item._hash === hash) {
          item.status = status;
          item._updated = new Date().toISOString();
          Object.assign(item, metadata);
          updated = true;
          return JSON.stringify(item);
        }
        return line;
      } catch {
        // Keep malformed lines as-is
        return line;
      }
    });

    if (updated) {
      writeFileSync(filePath, newLines.join('\n'));
    }

    return updated;
  }

  /**
   * Update a finding (convenience method for MCP server)
   * @param {string} hash - Finding hash
   * @param {object} updates - Updates to apply (status, issueId, etc.)
   * @returns {object|null} Updated finding or null if not found
   */
  updateFinding(hash, updates = {}) {
    const { status, issueId, ...metadata } = updates;

    // Update the status if provided
    if (status) {
      const success = this.updateStatus(hash, status, { issueId, ...metadata });
      if (!success) return null;
    } else if (issueId) {
      // Just link to issue without status change
      this.linkToIssue(hash, issueId);
    }

    // Return the updated finding
    return this.getByHash(hash);
  }

  /**
   * Link a finding to a Linear issue
   * @param {string} hash
   * @param {string} issueId
   */
  linkToIssue(hash, issueId) {
    this.index.byIssue[issueId] = hash;
    this.updateStatus(hash, 'tracked', { issueId });
    this._saveIndex();
  }

  /**
   * Get finding by Linear issue ID
   * @param {string} issueId
   */
  getByIssueId(issueId) {
    const hash = this.index.byIssue[issueId];
    if (!hash) return null;
    return this.getByHash(hash);
  }

  // ========== Pattern Management ==========

  /**
   * Add or update a fix pattern
   * @param {object} pattern
   * @returns {string} Pattern ID
   */
  addPattern(pattern) {
    const patternsPath = join(this.basePath, 'patterns', 'fix-patterns.json');

    let patterns = [];
    if (existsSync(patternsPath)) {
      try {
        patterns = JSON.parse(readFileSync(patternsPath, 'utf-8'));
      } catch {
        // Start fresh if patterns file is corrupted
        patterns = [];
      }
    }

    const patternId = pattern.patternId || `pattern-${Date.now()}`;
    const existing = patterns.findIndex(p => p.patternId === patternId);

    const record = {
      patternId,
      description: pattern.description,
      type: pattern.type,
      template: pattern.template,
      instances: (existing >= 0 ? patterns[existing].instances : 0) + 1,
      successCount: (existing >= 0 ? patterns[existing].successCount : 0) + (pattern.success ? 1 : 0),
      successRate: 0,
      filesFixed: [...new Set([
        ...(existing >= 0 ? patterns[existing].filesFixed : []),
        ...(pattern.files || []),
      ])],
      created: existing >= 0 ? patterns[existing].created : new Date().toISOString(),
      updated: new Date().toISOString(),
    };

    record.successRate = record.instances > 0 ? record.successCount / record.instances : 0;

    if (existing >= 0) {
      patterns[existing] = record;
    } else {
      patterns.push(record);
    }

    writeFileSync(patternsPath, JSON.stringify(patterns, null, 2));

    return patternId;
  }

  /**
   * Record pattern usage result
   * @param {string} patternId
   * @param {boolean} success
   * @param {string} file
   */
  recordPatternResult(patternId, success, file) {
    return this.addPattern({
      patternId,
      success,
      files: file ? [file] : [],
    });
  }

  /**
   * Get patterns with optional filters
   * @param {object} filters
   */
  getPatterns(filters = {}) {
    const patternsPath = join(this.basePath, 'patterns', 'fix-patterns.json');

    if (!existsSync(patternsPath)) return [];

    try {
      let patterns = JSON.parse(readFileSync(patternsPath, 'utf-8'));

      if (filters.type) {
        patterns = patterns.filter(p => p.type === filters.type);
      }

      if (filters.file) {
        patterns = patterns.filter(p =>
          p.filesFixed.some(f => f.includes(filters.file)),
        );
      }

      if (filters.minSuccessRate) {
        patterns = patterns.filter(p => p.successRate >= filters.minSuccessRate);
      }

      // Sort by success rate and instances
      patterns.sort((a, b) => {
        const scoreA = a.successRate * Math.log(a.instances + 1);
        const scoreB = b.successRate * Math.log(b.instances + 1);
        return scoreB - scoreA;
      });

      if (filters.limit) {
        patterns = patterns.slice(0, filters.limit);
      }

      return patterns;
    } catch {
      // Return empty on any file read error
      return [];
    }
  }

  // ========== Session Management ==========

  /**
   * Start a new session
   * @param {string} agentType
   * @returns {string} Session ID
   */
  startSession(agentType) {
    const sessionId = `${agentType}-${Date.now()}`;
    const session = {
      sessionId,
      agentType,
      started: new Date().toISOString(),
      status: 'running',
      findings: [],
      issues: [],
      fixes: [],
    };

    const sessionPath = join(this.basePath, 'sessions', `${sessionId}.json`);
    writeFileSync(sessionPath, JSON.stringify(session, null, 2));

    return sessionId;
  }

  /**
   * Update session with results
   * @param {string} sessionId
   * @param {object} updates
   */
  updateSession(sessionId, updates) {
    const sessionPath = join(this.basePath, 'sessions', `${sessionId}.json`);

    if (!existsSync(sessionPath)) return false;

    try {
      const session = JSON.parse(readFileSync(sessionPath, 'utf-8'));
      Object.assign(session, updates, { updated: new Date().toISOString() });
      writeFileSync(sessionPath, JSON.stringify(session, null, 2));
      return true;
    } catch {
      // Session update failed (file corrupted or deleted)
      return false;
    }
  }

  /**
   * End session
   * @param {string} sessionId
   * @param {string} status
   * @param {object} summary
   */
  endSession(sessionId, status = 'completed', summary = {}) {
    return this.updateSession(sessionId, {
      status,
      ended: new Date().toISOString(),
      summary,
    });
  }

  // ========== Retrieval Methods ==========

  /**
   * Get all findings (for SDK adapter compatibility)
   * @param {object} options
   * @param {number} options.limit - Max items to return (default: 1000)
   * @returns {object[]}
   */
  getAll(options = {}) {
    const limit = options.limit || 1000;
    return this.query({ limit });
  }

  // ========== Statistics ==========

  /**
   * Get storage statistics
   */
  getStats() {
    return {
      ...this.index.stats,
      patterns: this.getPatterns({ limit: 1000 }).length,
      sessions: this._getRecentRuns(1000).length,
      indexSize: Object.keys(this.index.hashes).length,
      filesCovered: Object.keys(this.index.byFile).length,
      typesCovered: Object.keys(this.index.byType).length,
    };
  }

  // ========== Export for Markdown Compatibility ==========

  /**
   * Export findings to markdown format (for Serena memory compatibility)
   * @param {object} filters
   * @returns {string}
   */
  exportToMarkdown(filters = {}) {
    const findings = this.query({ ...filters, limit: 500 });

    const lines = [
      '# CodeRabbit Findings Log',
      '',
      `*Exported: ${new Date().toISOString()}*`,
      '',
      '## Summary',
      '',
      `- **Total Findings**: ${this.index.stats.totalFindings}`,
      `- **Unique Findings**: ${this.index.stats.uniqueFindings}`,
      `- **Duplicates Skipped**: ${this.index.stats.duplicatesSkipped}`,
      '',
      '## Findings',
      '',
      '| Hash | File | Type | Status | Issue |',
      '|------|------|------|--------|-------|',
    ];

    for (const f of findings) {
      lines.push(`| ${f._hash.slice(0, 8)} | ${f.file || '-'} | ${f.type || '-'} | ${f.status || 'open'} | ${f.issueId || '-'} |`);
    }

    return lines.join('\n');
  }

  /**
   * Export patterns to markdown
   */
  exportPatternsToMarkdown() {
    const patterns = this.getPatterns({ limit: 100 });

    const lines = [
      '# Auto-Fix Patterns',
      '',
      `*Exported: ${new Date().toISOString()}*`,
      '',
    ];

    for (const p of patterns) {
      lines.push(`## ${p.patternId}`);
      lines.push('');
      lines.push(`- **Description**: ${p.description || 'N/A'}`);
      lines.push(`- **Type**: ${p.type || 'N/A'}`);
      lines.push(`- **Instances**: ${p.instances}`);
      lines.push(`- **Success Rate**: ${(p.successRate * 100).toFixed(1)}%`);
      lines.push(`- **Files**: ${p.filesFixed.join(', ') || 'N/A'}`);
      lines.push('');
      if (p.template) {
        lines.push('```');
        lines.push(p.template);
        lines.push('```');
        lines.push('');
      }
    }

    return lines.join('\n');
  }
}

export default ContextStore;
