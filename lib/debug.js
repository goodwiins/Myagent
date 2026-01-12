/**
 * Debug logging utility for GoodFlows
 *
 * Usage:
 *   DEBUG=goodflows:* node bin/mcp-server.js
 *   DEBUG=goodflows:session,goodflows:queue node bin/mcp-server.js
 *
 * Namespaces:
 *   goodflows:session  - Session management
 *   goodflows:queue    - Priority queue operations
 *   goodflows:store    - Context store operations
 *   goodflows:pattern  - Pattern tracker
 *   goodflows:plan     - Plan executor
 *   goodflows:mcp      - MCP server tools
 *
 * @module goodflows/lib/debug
 */

/**
 * Parse DEBUG environment variable
 * @returns {Set<string>} Set of enabled namespaces
 */
function parseDebugEnv() {
  const debugEnv = process.env.DEBUG || '';
  const namespaces = new Set();

  for (const ns of debugEnv.split(',')) {
    const trimmed = ns.trim();
    if (trimmed) {
      namespaces.add(trimmed);
    }
  }

  return namespaces;
}

/**
 * Check if a namespace matches any enabled pattern
 * @param {string} namespace - Namespace to check
 * @param {Set<string>} enabled - Enabled namespaces
 * @returns {boolean}
 */
function isEnabled(namespace, enabled) {
  for (const pattern of enabled) {
    if (pattern === namespace) return true;
    if (pattern === '*') return true;
    if (pattern.endsWith(':*')) {
      const prefix = pattern.slice(0, -1); // Remove '*'
      if (namespace.startsWith(prefix)) return true;
    }
    if (pattern === 'goodflows:*' && namespace.startsWith('goodflows:')) return true;
  }
  return false;
}

// Parse once at module load
const enabledNamespaces = parseDebugEnv();

/**
 * Color codes for different namespaces
 */
const COLORS = {
  'goodflows:session': '\x1b[36m',  // Cyan
  'goodflows:queue': '\x1b[33m',    // Yellow
  'goodflows:store': '\x1b[32m',    // Green
  'goodflows:pattern': '\x1b[35m',  // Magenta
  'goodflows:plan': '\x1b[34m',     // Blue
  'goodflows:mcp': '\x1b[31m',      // Red
};
const RESET = '\x1b[0m';

/**
 * Create a debug logger for a namespace
 * @param {string} namespace - Debug namespace (e.g., 'goodflows:session')
 * @returns {Function} Debug logging function
 */
export function createDebug(namespace) {
  const enabled = isEnabled(namespace, enabledNamespaces);
  const color = COLORS[namespace] || '\x1b[37m'; // White default

  if (!enabled) {
    // Return no-op function if not enabled
    return function noop() { /* debug disabled */ };
  }

  /**
   * Debug log function
   * @param {string} message - Log message
   * @param {...unknown} args - Additional arguments
   */
  return function debug(message, ...args) {
    const timestamp = new Date().toISOString().slice(11, 23); // HH:MM:SS.mmm
    const prefix = `${color}${timestamp} ${namespace}${RESET}`;

    if (args.length === 0) {
      console.error(`${prefix} ${message}`);
    } else if (args.length === 1 && typeof args[0] === 'object') {
      console.error(`${prefix} ${message}`, JSON.stringify(args[0], null, 2));
    } else {
      console.error(`${prefix} ${message}`, ...args);
    }
  };
}

/**
 * Check if any debug logging is enabled
 * @returns {boolean}
 */
export function isDebugEnabled() {
  return enabledNamespaces.size > 0;
}

/**
 * Pre-created debug loggers for common namespaces
 */
export const debug = {
  session: createDebug('goodflows:session'),
  queue: createDebug('goodflows:queue'),
  store: createDebug('goodflows:store'),
  pattern: createDebug('goodflows:pattern'),
  plan: createDebug('goodflows:plan'),
  mcp: createDebug('goodflows:mcp'),
};

export default debug;
