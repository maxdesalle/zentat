import { describe, expect, it, vi } from 'vitest';

// Spec: tests/trees/fetcher-selection.tree
//
// The property under test is which transport a given setting produces. That
// sounds trivial and is the single most privacy-critical branch in the
// codebase: if "Nym enabled" ever silently yields a direct fetcher, the user's
// IP reaches the price API while the UI says it did not.

const directFetch = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}) }));
const nymFetch = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}) }));

vi.mock('../../src/lib/fetch/direct', () => ({
  createDirectFetcher: vi.fn(() => ({ fetch: directFetch })),
}));
vi.mock('../../src/lib/fetch/nym', () => ({
  createNymFetcher: vi.fn(() => ({ fetch: nymFetch })),
  destroyNymConnection: vi.fn(),
  getNymStatus: vi.fn(),
  getStoredNymStatus: vi.fn(),
  resetNymConnection: vi.fn(),
  watchNymStatus: vi.fn(),
  watchStoredNymStatus: vi.fn(),
}));

const { createFetcher } = await import('../../src/lib/fetch/index');
const { createDirectFetcher } = await import('../../src/lib/fetch/direct');
const { createNymFetcher } = await import('../../src/lib/fetch/nym');

describe('given nym is disabled', () => {
  it('returns the direct fetcher', () => {
    createFetcher({ nymEnabled: false });
    expect(createDirectFetcher).toHaveBeenCalled();
  });

  it('never routes through the mixnet', async () => {
    vi.mocked(createNymFetcher).mockClear();
    await createFetcher({ nymEnabled: false, directTimeoutMs: 1234 }).fetch('https://x.test');
    expect(createNymFetcher).not.toHaveBeenCalled();
    expect(createDirectFetcher).toHaveBeenCalledWith(1234);
  });
});

describe('given nym is enabled', () => {
  it('returns the nym fetcher', () => {
    createFetcher({ nymEnabled: true, nymTimeoutMs: 5000 });
    expect(createNymFetcher).toHaveBeenCalledWith(5000);
  });

  it('never falls back to a direct request', async () => {
    vi.mocked(createDirectFetcher).mockClear();
    await createFetcher({ nymEnabled: true }).fetch('https://x.test');
    // Falling back would leak the IP the user asked to hide — a failed Nym
    // fetch must fail, not quietly succeed over clearnet.
    expect(createDirectFetcher).not.toHaveBeenCalled();
    expect(nymFetch).toHaveBeenCalled();
  });
});
