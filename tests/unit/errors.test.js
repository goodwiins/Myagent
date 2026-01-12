/**
 * Unit tests for Error classes
 */

import { describe, it, expect } from 'vitest';
import {
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
} from '../../lib/errors.js';

describe('GoodFlowsError', () => {
  it('should create error with code and message', () => {
    const error = new GoodFlowsError('TEST_ERROR', 'Test message');

    expect(error.code).toBe('TEST_ERROR');
    expect(error.message).toBe('Test message');
    expect(error.name).toBe('GoodFlowsError');
  });

  it('should include context', () => {
    const error = new GoodFlowsError('TEST_ERROR', 'Test', { sessionId: '123' });

    expect(error.context.sessionId).toBe('123');
  });

  it('should include timestamp', () => {
    const error = new GoodFlowsError('TEST_ERROR', 'Test');

    expect(error.timestamp).toBeDefined();
    expect(new Date(error.timestamp).getTime()).toBeLessThanOrEqual(Date.now());
  });

  describe('toJSON', () => {
    it('should serialize to JSON', () => {
      const error = new GoodFlowsError('TEST_ERROR', 'Test message', { extra: 'data' });
      const json = error.toJSON();

      expect(json.code).toBe('TEST_ERROR');
      expect(json.message).toBe('Test message');
      expect(json.context.extra).toBe('data');
      expect(json.timestamp).toBeDefined();
    });
  });

  describe('toMCPResponse', () => {
    it('should create MCP-compatible response', () => {
      const error = new GoodFlowsError('TEST_ERROR', 'Test message');
      const response = error.toMCPResponse();

      expect(response.isError).toBe(true);
      expect(response.content).toHaveLength(1);
      expect(response.content[0].type).toBe('text');

      const parsed = JSON.parse(response.content[0].text);
      expect(parsed.code).toBe('TEST_ERROR');
    });
  });
});

describe('SessionNotFoundError', () => {
  it('should create error with session ID', () => {
    const error = new SessionNotFoundError('ses_123');

    expect(error.code).toBe('SESSION_NOT_FOUND');
    expect(error.message).toContain('ses_123');
    expect(error.context.sessionId).toBe('ses_123');
    expect(error.name).toBe('SessionNotFoundError');
  });
});

describe('FindingNotFoundError', () => {
  it('should create error with hash', () => {
    const error = new FindingNotFoundError('abc123');

    expect(error.code).toBe('FINDING_NOT_FOUND');
    expect(error.message).toContain('abc123');
    expect(error.context.hash).toBe('abc123');
  });
});

describe('PlanNotFoundError', () => {
  it('should create error with plan ID', () => {
    const error = new PlanNotFoundError('plan_456');

    expect(error.code).toBe('PLAN_NOT_FOUND');
    expect(error.context.planId).toBe('plan_456');
  });
});

describe('QueueNotFoundError', () => {
  it('should create error with queue ID', () => {
    const error = new QueueNotFoundError('queue_789');

    expect(error.code).toBe('QUEUE_NOT_FOUND');
    expect(error.context.queueId).toBe('queue_789');
  });
});

describe('ValidationError', () => {
  it('should create error with validation errors array', () => {
    const errors = [
      { field: 'name', message: 'Required' },
      { field: 'type', message: 'Invalid value' },
    ];
    const error = new ValidationError('Validation failed', errors);

    expect(error.code).toBe('VALIDATION_ERROR');
    expect(error.errors).toEqual(errors);
    expect(error.context.errors).toEqual(errors);
  });
});

describe('ContextFileError', () => {
  it('should create error with operation details', () => {
    const error = new ContextFileError('write', 'STATE.md', 'File locked');

    expect(error.code).toBe('CONTEXT_FILE_ERROR');
    expect(error.context.operation).toBe('write');
    expect(error.context.file).toBe('STATE.md');
    expect(error.context.reason).toBe('File locked');
  });
});

describe('PatternNotFoundError', () => {
  it('should create error with pattern ID', () => {
    const error = new PatternNotFoundError('env-var-secret');

    expect(error.code).toBe('PATTERN_NOT_FOUND');
    expect(error.context.patternId).toBe('env-var-secret');
  });
});

describe('TimeoutError', () => {
  it('should create error with timeout details', () => {
    const error = new TimeoutError('plan_execution', 30000);

    expect(error.code).toBe('TIMEOUT');
    expect(error.context.operation).toBe('plan_execution');
    expect(error.context.timeoutMs).toBe(30000);
  });
});

describe('LinearAPIError', () => {
  it('should create error with API response', () => {
    const response = { status: 401, message: 'Unauthorized' };
    const error = new LinearAPIError('Authentication failed', response);

    expect(error.code).toBe('LINEAR_API_ERROR');
    expect(error.context.response).toEqual(response);
  });
});

describe('toMCPError', () => {
  it('should convert GoodFlowsError to MCP format', () => {
    const error = new SessionNotFoundError('ses_123');
    const response = toMCPError(error);

    expect(response.isError).toBe(true);
    expect(response.content[0].type).toBe('text');
  });

  it('should convert generic Error to MCP format', () => {
    const error = new Error('Something went wrong');
    const response = toMCPError(error);

    expect(response.isError).toBe(true);

    const parsed = JSON.parse(response.content[0].text);
    expect(parsed.code).toBe('UNKNOWN_ERROR');
    expect(parsed.message).toBe('Something went wrong');
  });
});

describe('withErrorHandling', () => {
  it('should wrap async function and return result on success', async () => {
    const fn = async (x) => x * 2;
    const wrapped = withErrorHandling(fn);

    const result = await wrapped(5);
    expect(result).toBe(10);
  });

  it('should catch errors and return MCP error format', async () => {
    const fn = async () => {
      throw new SessionNotFoundError('ses_123');
    };
    const wrapped = withErrorHandling(fn);

    const result = await wrapped();

    expect(result.isError).toBe(true);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.code).toBe('SESSION_NOT_FOUND');
  });

  it('should handle generic errors', async () => {
    const fn = async () => {
      throw new Error('Generic error');
    };
    const wrapped = withErrorHandling(fn);

    const result = await wrapped();

    expect(result.isError).toBe(true);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.code).toBe('UNKNOWN_ERROR');
  });
});
