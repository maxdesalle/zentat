/**
 * UI strings.
 *
 * Vanilla browser.i18n rather than a library: translations resolve
 * synchronously (so no flash of untranslated text), nothing is bundled twice,
 * and the manifest itself can be localised, which means the store listing name
 * and description follow the user's language too.
 *
 * The one limitation is that the language follows the browser, with no in-app
 * picker. For this product that is arguably right — the whole job is reading
 * the web in the user's own terms.
 *
 * Note the deliberate split: the extension's own chrome is translated here,
 * while converted PRICES follow the page's locale (see conversion/format.ts).
 * A German shop's prices should read in German conventions even for a user
 * whose browser is in English, because the number sits in that page's sentence.
 */

type MessageKey = string;

export function t(key: MessageKey, substitutions?: string | string[]): string {
  try {
    // The generated types narrow getMessage to known predefined keys; our own
    // catalogue keys are validated by the locale files, not by TypeScript.
    const getMessage = browser.i18n.getMessage as unknown as (
      key: string,
      substitutions?: string | string[],
    ) => string;
    const message = getMessage(key, substitutions);
    // getMessage returns '' for an unknown key, which would silently render an
    // empty label. Falling back to the key makes the omission visible instead.
    return message || key;
  } catch {
    return key;
  }
}

/** Apply translations to any element carrying data-i18n / data-i18n-attr. */
export function localizeDocument(root: ParentNode = document): void {
  for (const el of root.querySelectorAll<HTMLElement>('[data-i18n]')) {
    const key = el.dataset.i18n;
    if (key) el.textContent = t(key);
  }

  // data-i18n-attr="placeholder:someKey,title:otherKey"
  for (const el of root.querySelectorAll<HTMLElement>('[data-i18n-attr]')) {
    for (const pair of (el.dataset.i18nAttr ?? '').split(',')) {
      const [attr, key] = pair.split(':').map((part) => part.trim());
      if (attr && key) el.setAttribute(attr, t(key));
    }
  }
}
