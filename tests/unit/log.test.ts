import { afterEach, describe, expect, it, vi } from 'vitest';

// Spec: tests/trees/log.tree
//
// The two arms are chosen at module load from a build flag, so each needs its
// own fresh import.

async function loadWith(dev: boolean) {
  vi.stubEnv('DEV', dev);
  vi.resetModules();
  return import('../../src/lib/log');
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('debug', () => {
  describe('given a development build', () => {
    it('writes to the console', async () => {
      const log = vi.spyOn(console, 'log').mockImplementation(() => {});
      const { debug } = await loadWith(true);
      debug('hello');
      expect(log).toHaveBeenCalledOnce();
    });

    it('prefixes the message so it is greppable', async () => {
      // A shared console with a page's own logging is unreadable without it.
      const log = vi.spyOn(console, 'log').mockImplementation(() => {});
      const { debug } = await loadWith(true);
      debug('hello');
      expect(log.mock.calls[0]).toEqual(['Zentat:', 'hello']);
    });
  });

  describe('given a production build', () => {
    it('writes nothing', async () => {
      // Debug lines describe rate fetches and page contents. Shipping them
      // leaks what the user is browsing into any console anyone can open.
      const log = vi.spyOn(console, 'log').mockImplementation(() => {});
      const { debug } = await loadWith(false);
      debug('hello');
      expect(log).not.toHaveBeenCalled();
    });
  });
});
