// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  flushObserverRecords,
  setActiveObserver,
} from '../../src/entrypoints/content/state';

// Spec: tests/trees/content-state.tree
//
// The converter must discard the observer records its own DOM writes produce.
// A boolean flag cannot do it — observer callbacks arrive in a microtask AFTER
// the synchronous pass has reset the flag — so the converter drains the queue
// itself, mid-pass. But takeRecords() drains the WHOLE queue, so discarding the
// result threw away any page mutation queued in the same task and those nodes
// never converted at all.

const record = (target: Node) => ({ target } as MutationRecord);

function observerYielding(records: MutationRecord[]) {
  return { takeRecords: vi.fn(() => records) } as unknown as MutationObserver;
}

beforeEach(() => {
  setActiveObserver(null);
});

describe('setActiveObserver', () => {
  describe('given an observer and handlers', () => {
    it('uses them on the next flush', () => {
      const page = document.createElement('p');
      const replay = vi.fn();
      setActiveObserver(observerYielding([record(page)]), {
        replay,
        isOwnWrite: () => false,
      });
      flushObserverRecords();
      expect(replay).toHaveBeenCalledOnce();
    });
  });

  describe('given the observer is cleared', () => {
    it('stops flushing', () => {
      const replay = vi.fn();
      setActiveObserver(observerYielding([record(document.createElement('p'))]), {
        replay,
        isOwnWrite: () => false,
      });
      setActiveObserver(null);
      flushObserverRecords();
      expect(replay).not.toHaveBeenCalled();
    });
  });
});

describe('flushObserverRecords', () => {
  describe('given no observer is active', () => {
    it('does nothing', () => {
      expect(() => flushObserverRecords()).not.toThrow();
    });
  });

  describe('given the queue is empty', () => {
    it('replays nothing', () => {
      const replay = vi.fn();
      setActiveObserver(observerYielding([]), { replay, isOwnWrite: () => false });
      flushObserverRecords();
      expect(replay).not.toHaveBeenCalled();
    });
  });

  describe('given only our own writes are queued', () => {
    it('discards them', () => {
      // Replaying our own conversion would re-detect the ZEC text we just
      // wrote and convert it again.
      const replay = vi.fn();
      setActiveObserver(observerYielding([record(document.createElement('span'))]), {
        replay,
        isOwnWrite: () => true,
      });
      flushObserverRecords();
      expect(replay).not.toHaveBeenCalled();
    });
  });

  describe('given a page mutation is queued alongside ours', () => {
    const ours = document.createElement('span');
    const theirs = document.createElement('p');

    function flushMixed() {
      const replay = vi.fn();
      setActiveObserver(observerYielding([record(ours), record(theirs)]), {
        replay,
        isOwnWrite: (node) => node === ours,
      });
      flushObserverRecords();
      return replay;
    }

    it('replays the page mutation', () => {
      // The bug this exists for: draining the whole queue and discarding it
      // meant a price the site rendered in the same task never converted.
      expect(flushMixed().mock.calls[0][0]).toEqual([record(theirs)]);
    });

    it('does not replay ours', () => {
      expect(flushMixed().mock.calls[0][0]).toHaveLength(1);
    });
  });

  describe('given an observer with no handlers', () => {
    it('drains without replaying', () => {
      const observer = observerYielding([record(document.createElement('p'))]);
      setActiveObserver(observer);
      flushObserverRecords();
      expect(observer.takeRecords).toHaveBeenCalledOnce();
    });
  });
});
