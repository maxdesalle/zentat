import { resolve } from 'node:path';
import { defineConfig } from 'wxt';

export default defineConfig({
  // Firefox ships without the mixnet bundle. addons-linter refuses to parse any
  // single JS file over 5MB and @nymproject/mix-fetch-full-fat is one 22.9MB
  // index.js, which is the sole reason this extension has no AMO listing — and
  // therefore no Firefox Android, the only phone browser that runs extensions.
  // Aliasing the client to a stub keeps it out of the module graph entirely,
  // rather than relying on the bundler to prove a branch unreachable.
  vite: (env) =>
    env.browser === 'firefox'
      ? {
        resolve: {
          // Array form with a RegExp: Vite matches aliases against the import
          // specifier, so an absolute-path key misses the relative imports the
          // entrypoints actually use.
          alias: [
            {
              find: /^.*lib\/nym\/client$/,
              replacement: resolve('src/lib/nym/client.stub.ts'),
            },
          ],
        },
      }
      : {},
  srcDir: 'src',
  outDir: 'dist',
  manifest: ({ browser }) => ({
    name: 'Zentat',
    description: 'Convert fiat prices to ZEC inline',
    // activeTab powers the popup's "disable on this site" button without any
    // blanket host access. Note: NO <all_urls> host permission — the content
    // script's own `matches` key injects it, and extension-context fetches
    // only ever hit the three API hosts below.
    omnibox: { keyword: 'zec' },
    permissions: browser === 'chrome'
      ? ['storage', 'alarms', 'offscreen', 'activeTab', 'contextMenus']
      : ['storage', 'alarms', 'activeTab', 'contextMenus'],
    ...(browser === 'firefox' && {
      browser_specific_settings: {
        gecko: {
          id: 'zentat@zentat.org',
        },
        // Opts the listing in to Firefox for Android, which is the only
        // browser on a phone that runs extensions at all.
        gecko_android: {},
      },
    }),
    host_permissions: [
      'https://api.coingecko.com/*',
      'https://api.kraken.com/*',
      'wss://*.nymtech.net/*',
    ],
    icons: {
      16: 'icons/icon-16.png',
      32: 'icons/icon-32.png',
      48: 'icons/icon-48.png',
      128: 'icons/icon-128.png',
    },
    commands: {
      toggle: {
        suggested_key: {
          default: 'Alt+Z',
          mac: 'Alt+Z',
        },
        description: 'Toggle price conversion',
      },
    },
    content_security_policy: {
      extension_pages: "script-src 'self' 'wasm-unsafe-eval'; object-src 'self';",
    },
  }),
  webExt: {
    startUrls: ['https://www.amazon.com'],
  },
});
