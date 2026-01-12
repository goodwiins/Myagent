/**
 * GoodFlows Error Classes
 *
 * Standardized error handling for consistent error responses across
 * the MCP server and library functions.
 *
 * @module goodflows/lib/errors
 */

/**
 * Base error class for GoodFlows errors
 */
export class GoodFlowsError extends Error {
  /**
   * @param {string} code - Error code (e.g., 'SESSION_NOT_FOUND')
   * @param {string} message - Human-readable error message
   * @param {object} context - Additional context about the error
   */
  constructor(code, message, context = {}) {
    super(message);
    this.name = 'GoodFlowsError';
    this.code = code;
    this.context = context;
    this.timestamp = new Date().toISOString();

    // Capture stack trace
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, GoodFlowsError);
    }
  }

  /**
   * Convert to JSON-serializable object
   */
  toJSON() {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      context: this.context,
      timestamp: this.timestamp,
    };
  }

  /**
   * Convert to MCP error response format
   */
  toMCPResponse() {
    return {
      content: [{
        type: 'text',
        text: JSON.stringify(this.toJSON(), null, 2),
      }],
      isError: true,
    };
  }
}

/**
 * Error thrown when a session is not found
 */
export class SessionNotFoundError extends GoodFlowsError {
  constructor(sessionId) {
    super('SESSION_NOT_FOUND', `Session not found: ${sessionId}`, { sessionId });
    this.name = 'SessionNotFoundError';
  }
}

/**
 * Error thrown when a finding is not found
 */
export class FindingNotFoundError extends GoodFlowsError {
  constructor(hash) {
    super('FINDING_NOT_FOUND', `Finding not found: ${hash}`, { hash });
    this.name = 'FindingNotFoundError';
  }
}

/**
 * Error thrown when a plan is not found
 */
export class PlanNotFoundError extends GoodFlowsError {
  constructor(planId) {
    super('PLAN_NOT_FOUND', `Plan not found: ${planId}`, { planId });
    this.name = 'PlanNotFoundError';
  }
}

/**
 * Error thrown when a queue is not found
 */
export class QueueNotFoundError extends GoodFlowsError {
  constructor(queueId) {
    super('QUEUE_NOT_FOUND', `Queue not found: ${queueId}`, { queueId });
    this.name = 'QueueNotFoundError';
  }
}

/**
 * Error thrown when input validation fails
 */
export class ValidationError extends GoodFlowsError {
  constructor(message, errors = []) {
    super('VALIDATION_ERROR', message, { errors });
    this.name = 'ValidationError';
    this.errors = errors;
  }
}

/**
 * Error thrown when a context file operation fails
 */
export class ContextFileError extends GoodFlowsError {
  constructor(operation, file, reason) {
    super('CONTEXT_FILE_ERROR', `Failed to ${operation} ${file}: ${reason}`, { operation, file, reason });
    this.name = 'ContextFileError';
  }
}

/**
 * Error thrown when a pattern is not found
 */
export class PatternNotFoundError extends GoodFlowsError {
  constructor(patternId) {
    super('PATTERN_NOT_FOUND', `Pattern not found: ${patternId}`, { patternId });
    this.name = 'PatternNotFoundError';
  }
}

/**
 * Error thrown when an operation times out
 */
export class TimeoutError extends GoodFlowsError {
  constructor(operation, timeoutMs) {
    super('TIMEOUT', `Operation timed out after ${timeoutMs}ms: ${operation}`, { operation, timeoutMs });
    this.name = 'TimeoutError';
  }
}

/**
 * Error thrown when Linear API fails
 */
export class LinearAPIError extends GoodFlowsError {
  constructor(message, response = {}) {
    super('LINEAR_API_ERROR', message, { response });
    this.name = 'LinearAPIError';
  }
}

/**
 * Create a standardized error response for MCP
 * @param {Error|GoodFlowsError} error
 * @returns {object} MCP-compatible error response
 */
export function toMCPError(error) {
  if (error instanceof GoodFlowsError) {
    return error.toMCPResponse();
  }

  // Convert generic Error to GoodFlowsError format
  return {
    content: [{
      type: 'text',
      text: JSON.stringify({
        name: error.name || 'Error',
        code: 'UNKNOWN_ERROR',
        message: error.message,
        stack: error.stack,
        timestamp: new Date().toISOString(),
      }, null, 2),
    }],
    isError: true,
  };
}

/**
 * Wrap an async function with standardized error handling
 * @param {Function} fn - Async function to wrap
 * @returns {Function} Wrapped function that returns MCP-compatible responses
 */
export function withErrorHandling(fn) {
  return async (...args) => {
    try {
      return await fn(...args);
    } catch (error) {
      return toMCPError(error);
    }
  };
}

export default {
  GoodFlowsError,
  SessionNotFoundError,
  FindingNotFoundError,
  PlanNotFoundError,
  QueueNotFoundError,
  ValidationError,
  ContextFileError,
  PatternNotFoundError,
  TimeoutError,
  LinearAPIError,
  toMCPError,
  withErrorHandling,
};
