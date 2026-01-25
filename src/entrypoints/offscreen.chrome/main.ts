// Offscreen document for Nym mixnet fetching (Chrome only)
// This runs in a context with `window` available

import { nymFetch, type NymFetchResult } from '../../lib/nym/client';

interface NymFetchRequest {
  type: 'nymFetch';
  url: string;
  timeoutMs: number;
}

// Listen for messages from the background script
chrome.runtime.onMessage.addListener(
  (message: unknown, _sender, sendResponse: (response: NymFetchResult) => void) => {
    if (typeof message !== 'object' || message === null) {
      return;
    }

    const msg = message as NymFetchRequest;

    if (msg.type === 'nymFetch') {
      nymFetch(msg.url, msg.timeoutMs)
        .then(sendResponse)
        .catch((error) => {
          sendResponse({
            success: false,
            error: error instanceof Error ? error.message : String(error),
          });
        });
      return true; // Keep channel open for async response
    }
  }
);
