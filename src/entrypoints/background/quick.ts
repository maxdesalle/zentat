import { debug } from '../../lib/log';
import { quickConvert } from '../../lib/quick-convert';
import { getRates } from '../../lib/storage/rates';
import { getSettings } from '../../lib/storage/settings';

const MENU_ID = 'zentat-convert-selection';

/**
 * Two ways to ask "what is that in ZEC?" for text that is not a page price —
 * a figure in an email, a number a friend said, a salary. These are the first
 * moment a user goes looking rather than being shown, which is the step from
 * seeing prices in ZEC to thinking in it.
 */
export function setupQuickConvert(): void {
  setupContextMenu();
  setupOmnibox();
}

function setupContextMenu(): void {
  if (!browser.contextMenus) return;
  browser.contextMenus.removeAll().then(() => {
    browser.contextMenus.create({
      id: MENU_ID,
      title: 'Convert "%s" to ZEC',
      contexts: ['selection'],
    });
  }).catch((error) => debug(`context menu setup failed: ${error}`));

  browser.contextMenus.onClicked.addListener(async (info, tab) => {
    if (info.menuItemId !== MENU_ID || !info.selectionText || !tab?.id) return;
    const [rates, settings] = await Promise.all([getRates(), getSettings()]);
    const result = quickConvert(info.selectionText, rates, settings);

    // Shown through the content script rather than a notification: no extra
    // permission, and the answer appears where the user is already looking.
    browser.tabs.sendMessage(tab.id, {
      type: 'quickResult',
      text: result ? `${result.input} = ${result.output}` : 'No price found in that selection',
      ok: result !== null,
    }).catch(() => {
      // No content script on this page (an internal page, a PDF viewer).
    });
  });
}

function setupOmnibox(): void {
  if (!browser.omnibox) return;

  browser.omnibox.setDefaultSuggestion({
    description: 'Type an amount — "49.99 usd", "€20", or "0.5 zec"',
  });

  browser.omnibox.onInputChanged.addListener(async (text, suggest) => {
    const [rates, settings] = await Promise.all([getRates(), getSettings()]);
    const result = quickConvert(text, rates, settings);
    if (!result) {
      browser.omnibox.setDefaultSuggestion({
        description: 'Type an amount — "49.99 usd", "€20", or "0.5 zec"',
      });
      return;
    }
    browser.omnibox.setDefaultSuggestion({
      description: `${result.input} = ${result.output}`,
    });
    suggest([]);
  });

  // Nothing to navigate to: the answer was the suggestion line itself.
  browser.omnibox.onInputEntered.addListener(() => {});
}
