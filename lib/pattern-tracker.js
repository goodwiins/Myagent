/**
 * PatternTracker - Track and learn from successful fix patterns
 *
 * Features:
 * - Pattern extraction from successful fixes
 * - Confidence scoring based on success/failure history
 * - Template generation for common fix types
 * - Pattern recommendations based on similarity
 */

import { existsSync, readFileSync, writeFileSync, appendFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { findSimilar } from './context-index.js';

/**
 * Predefined fix pattern templates
 */
const BUILTIN_PATTERNS = {
  'env-var-secret': {
    patternId: 'env-var-secret',
    description: 'Replace hardcoded secrets with environment variables',
    type: 'critical_security',
    template: 'process.env.${SECRET_NAME}',
    regex: /(['"])((?:sk|api|secret|key|token|password|auth)[_-]?[a-zA-Z0-9]+)(['"])/gi,
    confidence: 0.95,
  },
  'async-lock': {
    patternId: 'async-lock',
    description: 'Wrap mutable state access in async lock',
    type: 'potential_issue',
    template: 'async with self._lock:\n    ${mutation}',
    confidence: 0.85,
  },
  'null-check': {
    patternId: 'null-check',
    description: 'Add null/undefined check before property access',
    type: 'potential_issue',
    template: '${object}?.${property}',
    confidence: 0.9,
  },
  'try-catch-async': {
    patternId: 'try-catch-async',
    description: 'Wrap async calls in try-catch',
    type: 'potential_issue',
    template: 'try {\n  ${asyncCall}\n} catch (error) {\n  console.error(error);\n  throw error;\n}',
    confidence: 0.8,
  },
  'input-validation': {
    patternId: 'input-validation',
    description: 'Add input validation',
    type: 'potential_issue',
    template: 'if (!${input} || typeof ${input} !== "${type}") {\n  throw new Error("Invalid ${input}");\n}',
    confidence: 0.85,
  },
};

/**
 * Pattern categories for grouping
 */
const PATTERN_CATEGORIES = {
  security: ['env-var-secret', 'input-validation', 'sql-escape', 'xss-escape'],
  nullSafety: ['null-check', 'optional-chaining', 'default-value'],
  asyncHandling: ['async-lock', 'try-catch-async', 'promise-all', 'race-condition'],
  typeGuards: ['type-check', 'instanceof-check', 'schema-validation'],
  refactoring: ['extract-function', 'rename-variable', 'simplify-condition'],
};

/**
 * PatternTracker class for learning and recommending fix patterns
 */
export class PatternTracker {
  /**
   * @param {object} options
   * @param {string} options.basePath - Base path for pattern storage
   * @param {boolean} options.includeBuiltins - Include predefined patterns
   */
  constructor(options = {}) {
    this.basePath = options.basePath || '.goodflows/context/patterns';
    this.includeBuiltins = options.includeBuiltins !== false;

    this._ensureDir();
    this.patterns = this._loadPatterns();
    this.history = this._loadHistory();
  }

  /**
   * Ensure pattern directory exists
   */
  _ensureDir() {
    if (!existsSync(this.basePath)) {
      mkdirSync(this.basePath, { recursive: true });
    }
  }

  /**
   * Load patterns from disk
   */
  _loadPatterns() {
    const patternsPath = join(this.basePath, 'patterns.json');

    let patterns = {};

    // Load builtins
    if (this.includeBuiltins) {
      patterns = { ...BUILTIN_PATTERNS };
    }

    // Load custom patterns
    if (existsSync(patternsPath)) {
      try {
        const custom = JSON.parse(readFileSync(patternsPath, 'utf-8'));
        patterns = { ...patterns, ...custom };
      } catch {
        // Keep builtins only
      }
    }

    return patterns;
  }

  /**
   * Load pattern usage history
   */
  _loadHistory() {
    const historyPath = join(this.basePath, 'history.jsonl');

    const history = [];

    if (existsSync(historyPath)) {
      const lines = readFileSync(historyPath, 'utf-8').split('\n').filter(Boolean);
      for (const line of lines) {
        try {
          history.push(JSON.parse(line));
        } catch {
          continue;
        }
      }
    }

    return history;
  }

  /**
   * Save patterns to disk
   */
  _savePatterns() {
    const patternsPath = join(this.basePath, 'patterns.json');

    // Only save custom patterns (not builtins)
    const custom = {};
    for (const [id, pattern] of Object.entries(this.patterns)) {
      if (!BUILTIN_PATTERNS[id]) {
        custom[id] = pattern;
      }
    }

    writeFileSync(patternsPath, JSON.stringify(custom, null, 2));
  }

  /**
   * Record a pattern usage
   * @param {string} patternId
   * @param {boolean} success
   * @param {object} context
   */
  _recordHistory(patternId, success, context = {}) {
    const historyPath = join(this.basePath, 'history.jsonl');

    const record = {
      patternId,
      success,
      timestamp: new Date().toISOString(),
      file: context.file,
      issueId: context.issueId,
      description: context.description,
    };

    this.history.push(record);

    // Append to file (efficient - doesn't read entire file)
    const line = JSON.stringify(record) + '\n';

    try {
      appendFileSync(historyPath, line);
    } catch {
      // Ignore write errors
    }
  }

  /**
   * Generate pattern ID from description
   * @param {string} description
   * @returns {string}
   */
  _generatePatternId(description) {
    const normalized = description.toLowerCase()
      .replace(/[^a-z0-9\s]/g, '')
      .trim()
      .split(/\s+/)
      .slice(0, 4)
      .join('-');

    return normalized || `pattern-${Date.now()}`;
  }

  /**
   * Register a new pattern from a successful fix
   * @param {object} fix
   * @param {string} fix.description - What the fix does
   * @param {string} fix.type - Finding type it applies to
   * @param {string} fix.before - Code before fix
   * @param {string} fix.after - Code after fix
   * @param {string} fix.file - File it was applied to
   * @param {string} fix.template - Optional template string
   * @returns {string} Pattern ID
   */
  registerPattern(fix) {
    const patternId = fix.patternId || this._generatePatternId(fix.description);

    // Check if pattern already exists
    if (this.patterns[patternId]) {
      // Update existing pattern
      this.patterns[patternId].instances++;
      this.patterns[patternId].successCount++;
      this.patterns[patternId].filesApplied.push(fix.file);
      this.patterns[patternId].filesApplied = [...new Set(this.patterns[patternId].filesApplied)];
      this.patterns[patternId].updated = new Date().toISOString();

      this._updateConfidence(patternId);
    } else {
      // Create new pattern
      this.patterns[patternId] = {
        patternId,
        description: fix.description,
        type: fix.type,
        template: fix.template || this._extractTemplate(fix.before, fix.after),
        before: fix.before,
        after: fix.after,
        regex: null,
        instances: 1,
        successCount: 1,
        failureCount: 0,
        confidence: 0.7, // Initial confidence
        filesApplied: [fix.file].filter(Boolean),
        created: new Date().toISOString(),
        updated: new Date().toISOString(),
      };
    }

    this._savePatterns();
    this._recordHistory(patternId, true, { file: fix.file });

    return patternId;
  }

  /**
   * Extract a template from before/after code
   * @param {string} before
   * @param {string} after
   * @returns {string}
   */
  _extractTemplate(before, after) {
    // Simple diff-based template extraction
    // Find common prefix and suffix
    let prefixLen = 0;
    while (prefixLen < before.length && prefixLen < after.length &&
           before[prefixLen] === after[prefixLen]) {
      prefixLen++;
    }

    let suffixLen = 0;
    while (suffixLen < before.length - prefixLen && suffixLen < after.length - prefixLen &&
           before[before.length - 1 - suffixLen] === after[after.length - 1 - suffixLen]) {
      suffixLen++;
    }

    // Create template with placeholder
    const template = `${after.slice(0, prefixLen)}\${change}${after.slice(after.length - suffixLen || undefined)}`;
    return template || after;
  }

  /**
   * Record pattern application result
   * @param {string} patternId
   * @param {boolean} success
   * @param {object} context
   */
  recordResult(patternId, success, context = {}) {
    const pattern = this.patterns[patternId];
    if (!pattern) return;

    pattern.instances++;
    if (success) {
      pattern.successCount++;
      if (context.file) {
        pattern.filesApplied.push(context.file);
        pattern.filesApplied = [...new Set(pattern.filesApplied)];
      }
    } else {
      pattern.failureCount++;
    }

    pattern.updated = new Date().toISOString();
    this._updateConfidence(patternId);

    this._savePatterns();
    this._recordHistory(patternId, success, context);
  }

  /**
   * Update pattern confidence based on history
   * @param {string} patternId
   */
  _updateConfidence(patternId) {
    const pattern = this.patterns[patternId];
    if (!pattern) return;

    // Bayesian-style confidence update
    // Prior: 0.7, weight: 5 (equivalent to 5 successful observations)
    const prior = 0.7;
    const priorWeight = 5;

    const totalObservations = pattern.successCount + pattern.failureCount;
    const observedSuccess = pattern.successCount / Math.max(1, totalObservations);

    // Weighted average of prior and observed
    const weight = Math.min(totalObservations / (totalObservations + priorWeight), 0.9);
    pattern.confidence = (1 - weight) * prior + weight * observedSuccess;

    // Cap at 0.99
    pattern.confidence = Math.min(0.99, pattern.confidence);
  }

  /**
   * Get patterns sorted by confidence
   * @param {object} filters
   * @returns {object[]}
   */
  getPatterns(filters = {}) {
    let patterns = Object.values(this.patterns);

    if (filters.type) {
      patterns = patterns.filter(p => p.type === filters.type);
    }

    if (filters.category) {
      const categoryPatterns = PATTERN_CATEGORIES[filters.category] || [];
      patterns = patterns.filter(p => categoryPatterns.includes(p.patternId));
    }

    if (filters.minConfidence) {
      patterns = patterns.filter(p => p.confidence >= filters.minConfidence);
    }

    if (filters.file) {
      patterns = patterns.filter(p =>
        p.filesApplied.some(f => f.includes(filters.file)),
      );
    }

    // Sort by confidence * log(instances + 1)
    patterns.sort((a, b) => {
      const scoreA = a.confidence * Math.log(a.instances + 1);
      const scoreB = b.confidence * Math.log(b.instances + 1);
      return scoreB - scoreA;
    });

    if (filters.limit) {
      patterns = patterns.slice(0, filters.limit);
    }

    return patterns;
  }

  /**
   * Recommend patterns for a finding
   * @param {object|string} findingOrType - Finding object or type string
   * @param {object|string} optionsOrDescription - Options object or description string
   * @param {object} extraOptions - Extra options (when using string signature)
   * @returns {object[]}
   */
  recommend(findingOrType, optionsOrDescription = {}, extraOptions = {}) {
    // Support both signatures:
    // recommend(finding, options) - original
    // recommend(type, description, options) - MCP server compatibility
    let finding;
    let options;

    if (typeof findingOrType === 'string') {
      // Called as recommend(type, description, options)
      finding = {
        type: findingOrType,
        description: typeof optionsOrDescription === 'string' ? optionsOrDescription : '',
      };
      options = typeof optionsOrDescription === 'object' ? optionsOrDescription : extraOptions;
    } else {
      // Called as recommend(finding, options)
      finding = findingOrType || {};
      options = optionsOrDescription || {};
    }

    const { limit = 3, minConfidence = 0.6 } = options;

    // Get patterns of same type
    let candidates = this.getPatterns({
      type: finding.type,
      minConfidence,
    });

    // If not enough, expand to similar types
    if (candidates.length < limit) {
      const allPatterns = this.getPatterns({ minConfidence });
      candidates = [...candidates, ...allPatterns.filter(p => !candidates.includes(p))];
    }

    // Find similar based on description
    if (finding.description) {
      const similar = findSimilar(finding, candidates, {
        threshold: 0.3,
        limit,
        weights: {
          description: 0.6,
          type: 0.4,
        },
      });

      if (similar.length > 0) {
        return similar;
      }
    }

    return candidates.slice(0, limit);
  }

  /**
   * Get pattern by ID
   * @param {string} patternId
   */
  getPattern(patternId) {
    return this.patterns[patternId];
  }

  /**
   * Record a successful pattern application (convenience method for MCP server)
   * @param {string} patternId
   * @param {object} context - { file, issueId, context }
   */
  recordSuccess(patternId, context = {}) {
    this.recordResult(patternId, true, context);
  }

  /**
   * Record a failed pattern application (convenience method for MCP server)
   * @param {string} patternId
   * @param {object} context - { file, issueId, reason }
   */
  recordFailure(patternId, context = {}) {
    this.recordResult(patternId, false, context);
  }

  /**
   * Add a new pattern (convenience method for MCP server)
   * @param {object} pattern - { id, type, description, template, keywords }
   * @returns {string} Pattern ID
   */
  addPattern(pattern) {
    const patternId = pattern.id || pattern.patternId || this._generatePatternId(pattern.description || '');

    this.patterns[patternId] = {
      patternId,
      description: pattern.description || '',
      type: pattern.type || 'other',
      template: pattern.template || '',
      keywords: pattern.keywords || [],
      regex: null,
      instances: 0,
      successCount: 0,
      failureCount: 0,
      confidence: 0.7,
      filesApplied: [],
      created: new Date().toISOString(),
      updated: new Date().toISOString(),
    };

    this._savePatterns();
    return patternId;
  }

  /**
   * Get pattern statistics
   */
  getStats() {
    const patterns = Object.values(this.patterns);

    return {
      totalPatterns: patterns.length,
      builtinPatterns: Object.keys(BUILTIN_PATTERNS).length,
      customPatterns: patterns.length - Object.keys(BUILTIN_PATTERNS).filter(id => this.patterns[id]).length,
      avgConfidence: patterns.length > 0
        ? patterns.reduce((sum, p) => sum + (p.confidence || 0), 0) / patterns.length
        : 0,
      totalApplications: patterns.reduce((sum, p) => sum + (p.instances || 0), 0),
      successRate: this.history.length > 0
        ? this.history.filter(h => h.success).length / this.history.length
        : 0,
      byType: this._groupByType(patterns),
      topPatterns: patterns
        .sort((a, b) => (b.instances || 0) - (a.instances || 0))
        .slice(0, 5)
        .map(p => ({ id: p.patternId, instances: p.instances || 0, confidence: p.confidence || 0 })),
    };
  }

  /**
   * Group patterns by type
   * @param {object[]} patterns
   */
  _groupByType(patterns) {
    const groups = {};
    for (const p of patterns) {
      const type = p.type || 'other';
      if (!groups[type]) {
        groups[type] = { count: 0, avgConfidence: 0 };
      }
      groups[type].count++;
      groups[type].avgConfidence += p.confidence;
    }

    for (const type in groups) {
      groups[type].avgConfidence /= groups[type].count;
    }

    return groups;
  }

  /**
   * Export patterns to markdown
   */
  exportToMarkdown() {
    const patterns = this.getPatterns({ limit: 100 });

    const lines = [
      '# Auto-Fix Patterns',
      '',
      `*Generated: ${new Date().toISOString()}*`,
      '',
      '## Statistics',
      '',
      `- **Total Patterns**: ${patterns.length}`,
      `- **Avg Confidence**: ${(patterns.reduce((s, p) => s + p.confidence, 0) / patterns.length * 100).toFixed(1)}%`,
      `- **Total Applications**: ${patterns.reduce((s, p) => s + p.instances, 0)}`,
      '',
      '## Patterns',
      '',
    ];

    for (const p of patterns) {
      lines.push(`### ${p.patternId}`);
      lines.push('');
      lines.push(`**${p.description}**`);
      lines.push('');
      lines.push(`- Type: \`${p.type || 'N/A'}\``);
      lines.push(`- Confidence: ${(p.confidence * 100).toFixed(1)}%`);
      lines.push(`- Applications: ${p.instances} (${p.successCount} success, ${p.failureCount} failure)`);
      lines.push(`- Files: ${p.filesApplied.slice(0, 5).join(', ')}${p.filesApplied.length > 5 ? '...' : ''}`);
      lines.push('');

      if (p.template) {
        lines.push('Template:');
        lines.push('```');
        lines.push(p.template);
        lines.push('```');
        lines.push('');
      }
    }

    return lines.join('\n');
  }
}

export default PatternTracker;
