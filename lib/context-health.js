/**
 * GoodFlows Context Health
 *
 * Provides visibility into context file health:
 * - File sizes vs limits
 * - Staleness indicators
 * - Coverage metrics
 * - Health scores
 *
 * @module goodflows/lib/context-health
 */

import { promises as fs } from 'fs';
import { existsSync, statSync } from 'fs';
import path from 'path';
import { SIZE_LIMITS, CONTEXT_FILES } from './context-files.js';

/**
 * Characters per token (approximate)
 */
const CHARS_PER_TOKEN = 4;

/**
 * Health thresholds (percentage of limit that triggers status change)
 */
export const HEALTH_THRESHOLDS = {
  GOOD: 0.7,       // < 70% of limit = good status
  WARNING: 0.7,    // >= 70% of limit = warning status
  CRITICAL: 0.9,   // >= 90% of limit = critical status
};

/**
 * Staleness thresholds (in days)
 */
export const STALENESS_THRESHOLDS = {
  FRESH: 1,        // Updated within 1 day
  RECENT: 7,       // Updated within 7 days
  STALE: 30,       // Updated within 30 days
  VERY_STALE: 90,  // Over 90 days
};

/**
 * Get current size of each context file
 *
 * @param {object} options - Options
 * @param {string} [options.basePath='.goodflows'] - Base path for context files
 * @returns {Promise<object>} File sizes in characters and tokens
 */
export async function getFileSizes(options = {}) {
  const { basePath = '.goodflows' } = options;
  const sizes = {};

  for (const [type, filename] of Object.entries(CONTEXT_FILES)) {
    const filePath = path.join(basePath, filename);

    try {
      if (existsSync(filePath)) {
        const content = await fs.readFile(filePath, 'utf-8');
        sizes[type] = {
          exists: true,
          chars: content.length,
          tokens: Math.ceil(content.length / CHARS_PER_TOKEN),
          lines: content.split('\n').length,
        };
      } else {
        sizes[type] = {
          exists: false,
          chars: 0,
          tokens: 0,
          lines: 0,
        };
      }
    } catch (error) {
      sizes[type] = {
        exists: false,
        chars: 0,
        tokens: 0,
        lines: 0,
        error: error.message,
      };
    }
  }

  return sizes;
}

/**
 * Get token limits for each context file
 *
 * @returns {object} Token limits from spec
 */
export function getFileLimits() {
  return { ...SIZE_LIMITS };
}

/**
 * Calculate health percentage for each file
 *
 * @param {object} options - Options
 * @param {string} [options.basePath='.goodflows'] - Base path for context files
 * @returns {Promise<object>} Health metrics for each file
 */
export async function calculateHealth(options = {}) {
  const sizes = await getFileSizes(options);
  const limits = getFileLimits();
  const health = {};

  for (const [type, size] of Object.entries(sizes)) {
    const limit = limits[type] || 0;
    const usedPercent = limit > 0 ? (size.tokens / limit) : 0;

    let status = 'good';
    if (!size.exists) {
      status = 'missing';
    } else if (usedPercent >= HEALTH_THRESHOLDS.CRITICAL) {
      status = 'critical';
    } else if (usedPercent >= HEALTH_THRESHOLDS.WARNING) {
      status = 'warning';
    }

    health[type] = {
      ...size,
      limit,
      usedPercent: Math.round(usedPercent * 100),
      remainingTokens: Math.max(0, limit - size.tokens),
      status,
    };
  }

  return health;
}

/**
 * Get staleness info for each context file
 *
 * @param {object} options - Options
 * @param {string} [options.basePath='.goodflows'] - Base path for context files
 * @returns {Promise<object>} Staleness info for each file
 */
export async function getStaleness(options = {}) {
  const { basePath = '.goodflows' } = options;
  const staleness = {};
  const now = Date.now();

  for (const [type, filename] of Object.entries(CONTEXT_FILES)) {
    const filePath = path.join(basePath, filename);

    try {
      if (existsSync(filePath)) {
        const stats = statSync(filePath);
        const lastModified = stats.mtime;
        const daysSinceUpdate = Math.floor((now - lastModified.getTime()) / (1000 * 60 * 60 * 24));

        let status = 'fresh';
        if (daysSinceUpdate > STALENESS_THRESHOLDS.VERY_STALE) {
          status = 'very_stale';
        } else if (daysSinceUpdate > STALENESS_THRESHOLDS.STALE) {
          status = 'stale';
        } else if (daysSinceUpdate > STALENESS_THRESHOLDS.RECENT) {
          status = 'recent';
        }

        staleness[type] = {
          exists: true,
          lastModified: lastModified.toISOString(),
          daysSinceUpdate,
          status,
        };
      } else {
        staleness[type] = {
          exists: false,
          lastModified: null,
          daysSinceUpdate: null,
          status: 'missing',
        };
      }
    } catch (error) {
      staleness[type] = {
        exists: false,
        lastModified: null,
        daysSinceUpdate: null,
        status: 'error',
        error: error.message,
      };
    }
  }

  return staleness;
}

/**
 * Get coverage info - which files exist
 *
 * @param {object} options - Options
 * @param {string} [options.basePath='.goodflows'] - Base path for context files
 * @returns {Promise<object>} Coverage metrics
 */
export async function getCoverage(options = {}) {
  const { basePath = '.goodflows' } = options;
  const totalFiles = Object.keys(CONTEXT_FILES).length;
  let existingFiles = 0;
  const fileStatus = {};

  for (const [type, filename] of Object.entries(CONTEXT_FILES)) {
    const filePath = path.join(basePath, filename);
    const exists = existsSync(filePath);

    fileStatus[type] = exists;
    if (exists) {
      existingFiles++;
    }
  }

  return {
    totalFiles,
    existingFiles,
    missingFiles: totalFiles - existingFiles,
    coveragePercent: Math.round((existingFiles / totalFiles) * 100),
    files: fileStatus,
  };
}

/**
 * Get overall context health summary
 *
 * @param {object} options - Options
 * @param {string} [options.basePath='.goodflows'] - Base path for context files
 * @returns {Promise<object>} Complete health summary
 */
export async function getHealthSummary(options = {}) {
  const [health, staleness, coverage] = await Promise.all([
    calculateHealth(options),
    getStaleness(options),
    getCoverage(options),
  ]);

  // Calculate overall health score
  let healthyFiles = 0;
  let warningFiles = 0;
  let criticalFiles = 0;
  let missingFiles = 0;
  let totalTokensUsed = 0;
  let totalTokensLimit = 0;

  const files = {};

  for (const [type, healthInfo] of Object.entries(health)) {
    const stalenessInfo = staleness[type];

    files[type] = {
      ...healthInfo,
      staleness: stalenessInfo,
    };

    totalTokensUsed += healthInfo.tokens;
    totalTokensLimit += healthInfo.limit;

    switch (healthInfo.status) {
      case 'good':
        healthyFiles++;
        break;
      case 'warning':
        warningFiles++;
        break;
      case 'critical':
        criticalFiles++;
        break;
      case 'missing':
        missingFiles++;
        break;
    }
  }

  // Calculate overall score (0-100)
  // Penalize for missing, critical, and warning files
  const totalFiles = Object.keys(CONTEXT_FILES).length;
  const baseScore = 100;
  const missingPenalty = missingFiles * 15;
  const criticalPenalty = criticalFiles * 10;
  const warningPenalty = warningFiles * 5;
  const overallScore = Math.max(0, baseScore - missingPenalty - criticalPenalty - warningPenalty);

  // Generate suggestions
  const suggestions = [];

  if (missingFiles > 0) {
    const missing = Object.entries(health)
      .filter(([, info]) => info.status === 'missing')
      .map(([type]) => type);
    suggestions.push(`Create missing files: ${missing.join(', ')}`);
  }

  if (criticalFiles > 0) {
    const critical = Object.entries(health)
      .filter(([, info]) => info.status === 'critical')
      .map(([type]) => type);
    suggestions.push(`Reduce size of: ${critical.join(', ')} (over token limit)`);
  }

  const staleFiles = Object.entries(staleness)
    .filter(([, info]) => info.status === 'stale' || info.status === 'very_stale')
    .map(([type]) => type);
  if (staleFiles.length > 0) {
    suggestions.push(`Review stale files: ${staleFiles.join(', ')}`);
  }

  return {
    overallScore,
    status: overallScore >= 80 ? 'healthy' : overallScore >= 60 ? 'needs_attention' : 'unhealthy',
    summary: {
      totalFiles,
      healthyFiles,
      warningFiles,
      criticalFiles,
      missingFiles,
      totalTokensUsed,
      totalTokensLimit,
      totalUsagePercent: Math.round((totalTokensUsed / totalTokensLimit) * 100),
    },
    coverage,
    files,
    suggestions,
    generatedAt: new Date().toISOString(),
  };
}

/**
 * Format health summary for CLI display
 *
 * @param {object} summary - Health summary from getHealthSummary
 * @param {object} options - Format options
 * @param {boolean} [options.color=true] - Use ANSI colors
 * @returns {string} Formatted output
 */
export function formatHealthReport(summary, options = {}) {
  const { color = true } = options;

  const colors = color ? {
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    red: '\x1b[31m',
    gray: '\x1b[90m',
    reset: '\x1b[0m',
    bold: '\x1b[1m',
  } : {
    green: '', yellow: '', red: '', gray: '', reset: '', bold: '',
  };

  const statusColor = (status) => {
    switch (status) {
      case 'good':
      case 'fresh':
      case 'healthy':
        return colors.green;
      case 'warning':
      case 'recent':
      case 'needs_attention':
        return colors.yellow;
      case 'critical':
      case 'stale':
      case 'very_stale':
      case 'unhealthy':
        return colors.red;
      case 'missing':
        return colors.gray;
      default:
        return colors.reset;
    }
  };

  const lines = [];

  // Header
  lines.push(`${colors.bold}Context Health Report${colors.reset}`);
  lines.push(`Generated: ${summary.generatedAt}`);
  lines.push('');

  // Overall score
  const scoreColor = statusColor(summary.status);
  lines.push(`${colors.bold}Overall Score:${colors.reset} ${scoreColor}${summary.overallScore}/100 (${summary.status})${colors.reset}`);
  lines.push('');

  // Summary
  lines.push(`${colors.bold}Summary:${colors.reset}`);
  lines.push(`  Files: ${summary.summary.healthyFiles} healthy, ${summary.summary.warningFiles} warning, ${summary.summary.criticalFiles} critical, ${summary.summary.missingFiles} missing`);
  lines.push(`  Tokens: ${summary.summary.totalTokensUsed}/${summary.summary.totalTokensLimit} (${summary.summary.totalUsagePercent}%)`);
  lines.push(`  Coverage: ${summary.coverage.coveragePercent}%`);
  lines.push('');

  // File details
  lines.push(`${colors.bold}Files:${colors.reset}`);
  lines.push('');

  for (const [type, info] of Object.entries(summary.files)) {
    const sizeStatus = statusColor(info.status);
    const stalenessStatus = statusColor(info.staleness?.status || 'missing');

    // Progress bar
    const barWidth = 20;
    const filled = Math.min(barWidth, Math.round((info.usedPercent / 100) * barWidth));
    const bar = '█'.repeat(filled) + '░'.repeat(barWidth - filled);

    const statusEmoji = {
      good: '✓',
      warning: '!',
      critical: '✗',
      missing: '-',
    }[info.status] || '?';

    lines.push(`  ${type}:`);
    if (info.exists) {
      lines.push(`    ${sizeStatus}[${bar}]${colors.reset} ${info.tokens}/${info.limit} tokens (${info.usedPercent}%) ${statusEmoji}`);
      lines.push(`    ${stalenessStatus}Last updated: ${info.staleness?.daysSinceUpdate || '?'} days ago (${info.staleness?.status || 'unknown'})${colors.reset}`);
    } else {
      lines.push(`    ${colors.gray}[Not created]${colors.reset}`);
    }
    lines.push('');
  }

  // Suggestions
  if (summary.suggestions.length > 0) {
    lines.push(`${colors.bold}Suggestions:${colors.reset}`);
    for (const suggestion of summary.suggestions) {
      lines.push(`  ${colors.yellow}•${colors.reset} ${suggestion}`);
    }
  }

  return lines.join('\n');
}

export default {
  getFileSizes,
  getFileLimits,
  calculateHealth,
  getStaleness,
  getCoverage,
  getHealthSummary,
  formatHealthReport,
  HEALTH_THRESHOLDS,
  STALENESS_THRESHOLDS,
};
