// Offscreen document for Nym mixnet fetching (Chrome only)
// This runs in a context with `window` available

import { nymFetch } from '../../lib/nym/client';
import { isAllowedNymUrl, type NymFetchRequest, type NymFetchResult } from '../../lib/nym/shared';

const DEFAULT_TIMEOUT_MS = 60000;

// Listen for messages from the background script
chrome.runtime.onMessage.addListener(
  (message: unknown, _sender, sendResponse: (response: NymFetchResult) => void) => {
    if (typeof message !== 'object' || message === null) {
      return;
    }

    const msg = message as Partial<NymFetchRequest>;

    if (msg.type === 'nymFetch') {
      if (typeof msg.url !== 'string' || !isAllowedNymUrl(msg.url)) {
        sendResponse({ success: false, error: 'Invalid or disallowed URL' });
        return;
      }
      const timeoutMs = typeof msg.timeoutMs === 'number' && msg.timeoutMs > 0
        ? msg.timeoutMs
        : DEFAULT_TIMEOUT_MS;

      nymFetch(msg.url, timeoutMs)
        .then(sendResponse)
        .catch((error) => {
          sendResponse({
            success: false,
            error: error instanceof Error ? error.message : String(error),
          });
        });
      return true; // Keep channel open for async response
    }
  },
);
