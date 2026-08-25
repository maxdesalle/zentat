import { defineConfig } from 'wxt';

export default defineConfig({
  srcDir: 'src',
  outDir: 'dist',
  manifest: ({ browser }) => ({
    name: 'Zentat',
    description: 'Convert fiat prices to ZEC inline',
    // activeTab powers the popup's "disable on this site" button without any
    // blanket host access. Note: NO <all_urls> host permission — the content
    // script's own `matches` key injects it, and extension-context fetches
    // only ever hit the three API hosts below.
    permissions: browser === 'chrome'
      ? ['storage', 'alarms', 'offscreen', 'activeTab']
      : ['storage', 'alarms', 'activeTab'],
    ...(browser === 'firefox' && {
      browser_specific_settings: {
        gecko: {
          id: 'zentat@zentat.org',
        },
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
