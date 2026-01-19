/**
 * SyncActivity - Activity logging for cross-LLM collaboration
 *
 * Tracks all sync events (exports, imports, merges) to provide
 * visibility into collaborative work across different LLMs.
 *
 * @module lib/sync-activity
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';

/**
 * Activity event types
 */
export const ACTIVITY_TYPES = {
  EXPORT: 'export',
  IMPORT: 'import',
  MERGE: 'merge',
  SESSION_START: 'session_start',
  SESSION_END: 'session_end',
  WORK_COMPLETED: 'work_completed',
};

/**
 * Default configuration
 */
const DEFAULT_CONFIG = {
  maxEvents: 100,           // Maximum events to keep in log
  activityFile: 'activity.json',
};

/**
 * SyncActivity class for tracking LLM collaboration events
 */
export class SyncActivity {
  /**
   * @param {Object} options - Configuration options
   * @param {string} options.syncPath - Path to sync directory
   * @param {Object} options.config - Override default config
   */
  constructor(options = {}) {
    this.syncPath = options.syncPath || join(process.cwd(), '.goodflows', 'sync');
    this.config = { ...DEFAULT_CONFIG, ...options.config };
    this.activityPath = join(this.syncPath, this.config.activityFile);
    this._ensureDir();
  }

  /**
   * Ensure sync directory exists
   * @private
   */
  _ensureDir() {
    const dir = dirname(this.activityPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
  }

  /**
   * Load activity log from disk
   * @private
   * @returns {Array} Activity events
   */
  _load() {
    if (!existsSync(this.activityPath)) {
      return [];
    }
    try {
      const content = readFileSync(this.activityPath, 'utf-8');
      return JSON.parse(content);
    } catch {
      return [];
    }
  }

  /**
   * Save activity log to disk
   * @private
   * @param {Array} events - Activity events
   */
  _save(events) {
    // Trim to max events
    const trimmed = events.slice(-this.config.maxEvents);
    writeFileSync(this.activityPath, JSON.stringify(trimmed, null, 2));
  }

  /**
   * Log an activity event
   * @param {Object} event - Event to log
   * @param {string} event.type - Event type (export, import, merge, etc.)
   * @param {string} event.llm - LLM identifier
   * @param {string} [event.message] - Human-readable summary
   * @param {Object} [event.data] - Additional event data
   * @returns {Object} Logged event with timestamp
   */
  log(event) {
    const events = this._load();

    const loggedEvent = {
      id: `evt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      type: event.type,
      llm: event.llm,
      message: event.message || null,
      data: event.data || {},
      timestamp: new Date().toISOString(),
    };

    events.push(loggedEvent);
    this._save(events);

    return loggedEvent;
  }

  /**
   * Log an export event
   * @param {string} llm - LLM that exported
   * @param {string} message - Export message/summary
   * @param {Object} stats - Export statistics
   * @returns {Object} Logged event
   */
  logExport(llm, message, stats = {}) {
    return this.log({
      type: ACTIVITY_TYPES.EXPORT,
      llm,
      message,
      data: { stats },
    });
  }

  /**
   * Log an import event
   * @param {string} importingLlm - LLM doing the import
   * @param {string} fromLlm - LLM being imported from
   * @param {Object} stats - Import statistics
   * @returns {Object} Logged event
   */
  logImport(importingLlm, fromLlm, stats = {}) {
    return this.log({
      type: ACTIVITY_TYPES.IMPORT,
      llm: importingLlm,
      message: `Imported context from ${fromLlm}`,
      data: { fromLlm, stats },
    });
  }

  /**
   * Log a merge event
   * @param {string} llm - LLM performing merge
   * @param {Array<string>} sources - LLMs being merged
   * @param {string} strategy - Merge strategy used
   * @returns {Object} Logged event
   */
  logMerge(llm, sources, strategy) {
    return this.log({
      type: ACTIVITY_TYPES.MERGE,
      llm,
      message: `Merged context from: ${sources.join(', ')}`,
      data: { sources, strategy },
    });
  }

  /**
   * Log work completion
   * @param {string} llm - LLM that completed work
   * @param {Object} summary - Work summary
   * @returns {Object} Logged event
   */
  logWorkCompleted(llm, summary) {
    return this.log({
      type: ACTIVITY_TYPES.WORK_COMPLETED,
      llm,
      message: summary.title || summary.description || 'Work completed',
      data: { summary },
    });
  }

  /**
   * Get recent activity
   * @param {Object} options - Query options
   * @param {number} [options.limit=10] - Maximum events to return
   * @param {string} [options.llm] - Filter by LLM
   * @param {string} [options.type] - Filter by event type
   * @param {string} [options.since] - ISO timestamp to filter from
   * @returns {Array} Recent activity events
   */
  getActivity(options = {}) {
    const { limit = 10, llm, type, since } = options;
    let events = this._load();

    // Apply filters
    if (llm) {
      events = events.filter(e => e.llm === llm);
    }
    if (type) {
      events = events.filter(e => e.type === type);
    }
    if (since) {
      events = events.filter(e => e.timestamp >= since);
    }

    // Return most recent first
    return events.reverse().slice(0, limit);
  }

  /**
   * Get activity summary by LLM
   * @returns {Object} Summary of activity per LLM
   */
  getSummaryByLLM() {
    const events = this._load();
    const summary = {};

    for (const event of events) {
      if (!summary[event.llm]) {
        summary[event.llm] = {
          llm: event.llm,
          totalEvents: 0,
          lastActivity: null,
          lastMessage: null,
          exports: 0,
          imports: 0,
          merges: 0,
        };
      }

      const s = summary[event.llm];
      s.totalEvents++;
      s.lastActivity = event.timestamp;
      s.lastMessage = event.message;

      if (event.type === ACTIVITY_TYPES.EXPORT) s.exports++;
      if (event.type === ACTIVITY_TYPES.IMPORT) s.imports++;
      if (event.type === ACTIVITY_TYPES.MERGE) s.merges++;
    }

    return summary;
  }

  /**
   * Get time since last activity for an LLM
   * @param {string} llm - LLM identifier
   * @returns {Object} Freshness info
   */
  getFreshness(llm) {
    const events = this._load();
    const llmEvents = events.filter(e => e.llm === llm);

    if (llmEvents.length === 0) {
      return {
        llm,
        status: 'unknown',
        lastActivity: null,
        timeSince: null,
        message: 'No activity recorded',
      };
    }

    const lastEvent = llmEvents[llmEvents.length - 1];
    const lastTime = new Date(lastEvent.timestamp);
    const now = new Date();
    const diffMs = now - lastTime;
    const diffMinutes = Math.floor(diffMs / 60000);

    let status;
    let timeSince;

    if (diffMinutes < 5) {
      status = 'fresh';
      timeSince = 'just now';
    } else if (diffMinutes < 30) {
      status = 'recent';
      timeSince = `${diffMinutes}min ago`;
    } else if (diffMinutes < 60) {
      status = 'stale';
      timeSince = `${diffMinutes}min ago`;
    } else if (diffMinutes < 1440) {
      status = 'old';
      timeSince = `${Math.floor(diffMinutes / 60)}h ago`;
    } else {
      status = 'outdated';
      timeSince = `${Math.floor(diffMinutes / 1440)}d ago`;
    }

    return {
      llm,
      status,
      lastActivity: lastEvent.timestamp,
      timeSince,
      message: lastEvent.message,
      type: lastEvent.type,
    };
  }

  /**
   * Clear all activity (for testing)
   */
  clear() {
    this._save([]);
  }
}

/**
 * Create a new SyncActivity instance
 * @param {Object} options - Configuration options
 * @returns {SyncActivity}
 */
export function createSyncActivity(options = {}) {
  return new SyncActivity(options);
}

export default {
  SyncActivity,
  createSyncActivity,
  ACTIVITY_TYPES,
};
