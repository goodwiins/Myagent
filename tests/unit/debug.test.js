/**
 * Tests for debug.js
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// We need to dynamically import debug.js to test with different DEBUG values
describe('debug module', () => {
  let originalDebug;

  beforeEach(() => {
    originalDebug = process.env.DEBUG;
    vi.resetModules();
  });

  afterEach(() => {
    if (originalDebug !== undefined) {
      process.env.DEBUG = originalDebug;
    } else {
      delete process.env.DEBUG;
    }
  });

  describe('createDebug', () => {
    it('should return a no-op function when debug is disabled', async () => {
      delete process.env.DEBUG;
      const { createDebug } = await import('../../lib/debug.js');

      const debugFn = createDebug('goodflows:test');

      // Should be a function
      expect(typeof debugFn).toBe('function');

      // Calling it should not throw
      expect(() => debugFn('test message')).not.toThrow();
    });

    it('should return a logging function when namespace is enabled', async () => {
      process.env.DEBUG = 'goodflows:test';
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      // Reset modules to pick up new DEBUG value
      vi.resetModules();
      const { createDebug } = await import('../../lib/debug.js');

      const debugFn = createDebug('goodflows:test');
      debugFn('test message');

      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });

    it('should enable all namespaces with wildcard', async () => {
      process.env.DEBUG = '*';
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      vi.resetModules();
      const { createDebug } = await import('../../lib/debug.js');

      const debugFn = createDebug('anything:here');
      debugFn('test');

      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });

    it('should enable goodflows namespace with prefix wildcard', async () => {
      process.env.DEBUG = 'goodflows:*';
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      vi.resetModules();
      const { createDebug } = await import('../../lib/debug.js');

      const debugFn = createDebug('goodflows:session');
      debugFn('test');

      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });

    it('should handle multiple namespaces', async () => {
      process.env.DEBUG = 'goodflows:session,goodflows:queue';
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      vi.resetModules();
      const { createDebug } = await import('../../lib/debug.js');

      const sessionDebug = createDebug('goodflows:session');
      const queueDebug = createDebug('goodflows:queue');
      const storeDebug = createDebug('goodflows:store');

      sessionDebug('test');
      expect(consoleSpy).toHaveBeenCalledTimes(1);

      queueDebug('test');
      expect(consoleSpy).toHaveBeenCalledTimes(2);

      // Store is not enabled
      storeDebug('test');
      expect(consoleSpy).toHaveBeenCalledTimes(2); // Still 2

      consoleSpy.mockRestore();
    });

    it('should format object arguments as JSON', async () => {
      process.env.DEBUG = 'goodflows:test';
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      vi.resetModules();
      const { createDebug } = await import('../../lib/debug.js');

      const debugFn = createDebug('goodflows:test');
      debugFn('message', { key: 'value' });

      expect(consoleSpy).toHaveBeenCalled();
      // The second argument should be JSON
      const callArgs = consoleSpy.mock.calls[0];
      expect(callArgs[1]).toContain('key');
      consoleSpy.mockRestore();
    });

    it('should handle multiple non-object arguments', async () => {
      process.env.DEBUG = 'goodflows:test';
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      vi.resetModules();
      const { createDebug } = await import('../../lib/debug.js');

      const debugFn = createDebug('goodflows:test');
      debugFn('message', 'arg1', 'arg2');

      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });
  });

  describe('isDebugEnabled', () => {
    it('should return false when DEBUG is not set', async () => {
      delete process.env.DEBUG;

      vi.resetModules();
      const { isDebugEnabled } = await import('../../lib/debug.js');

      expect(isDebugEnabled()).toBe(false);
    });

    it('should return true when DEBUG is set', async () => {
      process.env.DEBUG = 'goodflows:session';

      vi.resetModules();
      const { isDebugEnabled } = await import('../../lib/debug.js');

      expect(isDebugEnabled()).toBe(true);
    });
  });

  describe('debug namespace exports', () => {
    it('should export pre-created debug loggers', async () => {
      delete process.env.DEBUG;

      vi.resetModules();
      const { debug } = await import('../../lib/debug.js');

      expect(debug.session).toBeDefined();
      expect(debug.queue).toBeDefined();
      expect(debug.store).toBeDefined();
      expect(debug.pattern).toBeDefined();
      expect(debug.plan).toBeDefined();
      expect(debug.mcp).toBeDefined();
    });

    it('should export default as debug object', async () => {
      delete process.env.DEBUG;

      vi.resetModules();
      const debugModule = await import('../../lib/debug.js');

      expect(debugModule.default).toBe(debugModule.debug);
    });
  });

  describe('edge cases', () => {
    it('should handle empty DEBUG string', async () => {
      process.env.DEBUG = '';

      vi.resetModules();
      const { isDebugEnabled } = await import('../../lib/debug.js');

      expect(isDebugEnabled()).toBe(false);
    });

    it('should handle DEBUG with whitespace', async () => {
      process.env.DEBUG = '  goodflows:session  ,  goodflows:queue  ';
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      vi.resetModules();
      const { createDebug } = await import('../../lib/debug.js');

      const sessionDebug = createDebug('goodflows:session');
      sessionDebug('test');

      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });

    it('should use white color for unknown namespaces', async () => {
      process.env.DEBUG = 'unknown:namespace';
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      vi.resetModules();
      const { createDebug } = await import('../../lib/debug.js');

      const debugFn = createDebug('unknown:namespace');
      debugFn('test');

      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });

    it('should include timestamp in output', async () => {
      process.env.DEBUG = 'goodflows:test';
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      vi.resetModules();
      const { createDebug } = await import('../../lib/debug.js');

      const debugFn = createDebug('goodflows:test');
      debugFn('test message');

      expect(consoleSpy).toHaveBeenCalled();
      const output = consoleSpy.mock.calls[0][0];
      // Should contain HH:MM:SS.mmm format
      expect(output).toMatch(/\d{2}:\d{2}:\d{2}\.\d{3}/);
      consoleSpy.mockRestore();
    });
  });
});
