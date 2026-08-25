import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const require = createRequire(import.meta.url);

/**
 * mix-fetch's worker resolves its WASM with `new URL('x.wasm', import.meta.url)`.
 * Vite copies the worker file verbatim without rewriting those, so the two
 * binaries are never emitted and the build succeeds while failing at the first
 * real fetch. They have to land in the same output directory as the worker.
 */
function nymWasmAssets(): PluginOption {
  return {
    name: 'nym-wasm-assets',
    generateBundle(this: PluginContext) {
      for (const file of ['mix_fetch_wasm_bg.wasm', 'go_conn.wasm']) {
        this.emitFile({
          type: 'asset',
          fileName: `assets/${file}`,
          source: readFileSync(require.resolve(`@nymproject/mix-fetch/${file}`)),
        });
      }
    },
  };
}
import type { PluginContext } from 'rollup';
import type { PluginOption } from 'vite';
import { defineConfig } from 'wxt';

export default defineConfig({
  // Both browsers now carry Nym. The AMO blocker was never the total size —
  // it is addons-linter's 5MB per-FILE JavaScript parse limit, and the
  // -full-fat package was one 22.9MB index.js because it base64-inlines the
  // WASM. The standard package ships the same two binaries as real .wasm files,
  // which the linter classifies as binary and never parses, so the largest
  // JavaScript file drops to ~100KB.
  vite: () => ({ plugins: [nymWasmAssets()] }),
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
