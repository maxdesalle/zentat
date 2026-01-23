// Offscreen document for Nym mixnet fetching
// This runs in a context with `window` available

import { mixFetch } from '@nymproject/mix-fetch-full-fat';

interface NymFetchRequest {
  type: 'nymFetch';
  url: string;
  timeoutMs: number;
}

interface NymFetchResponse {
  success: boolean;
  data?: unknown;
  status?: number;
  error?: string;
}

// Listen for messages from the background script
chrome.runtime.onMessage.addListener(
  (message: unknown, _sender, sendResponse: (response: NymFetchResponse) => void) => {
    if (typeof message !== 'object' || message === null) {
      return;
    }

    const msg = message as NymFetchRequest;

    if (msg.type === 'nymFetch') {
      handleNymFetch(msg.url, msg.timeoutMs)
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

async function handleNymFetch(url: string, timeoutMs: number): Promise<NymFetchResponse> {
  // Use Promise.race for timeout since AbortSignal can't be passed to Nym's internal Worker
  const timeoutPromise = new Promise<NymFetchResponse>((_, reject) => {
    setTimeout(() => reject(new Error('Nym fetch timeout')), timeoutMs);
  });

  const fetchPromise = (async (): Promise<NymFetchResponse> => {
    try {
      const response = await mixFetch(url);

      if (!response.ok) {
        return {
          success: false,
          status: response.status,
          error: `HTTP ${response.status}`,
        };
      }

      const data = await response.json();
      return {
        success: true,
        status: response.status,
        data,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  })();

  try {
    return await Promise.race([fetchPromise, timeoutPromise]);
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
