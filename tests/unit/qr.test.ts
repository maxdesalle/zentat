import qrcode from 'qrcode-generator';
import { describe, expect, it } from 'vitest';
import { qrSvg } from '../../src/lib/qr';
import { buildPaymentUri } from '../../src/lib/zip321';

// Spec: tests/trees/qr.tree

const UA = 'u1' + 'a'.repeat(60);

/** Four modules of margin. Below that, many scanners never lock on. */
const QUIET_ZONE = 4;

/** The dark modules an SVG actually draws, as "col,row" in viewBox space. */
function drawnModules(svg: string): Set<string> {
  const d = /<path d="([^"]*)"/.exec(svg)![1];
  const module = /M(-?\d+) (-?\d+)h1v1h-1z/g;
  const drawn = new Set<string>();
  let consumed = 0;
  for (let match = module.exec(d); match; match = module.exec(d)) {
    consumed += match[0].length;
    drawn.add(`${match[1]},${match[2]}`);
  }
  // Anything else in the path data gets drawn too, and a stray mark on a QR is
  // a QR that reads back as something the payer never agreed to.
  expect(consumed).toBe(d.length);
  return drawn;
}

/** What the encoder itself calls dark, placed inside the quiet zone. */
function encodedModules(text: string): Set<string> {
  const qr = qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  const count = qr.getModuleCount();
  const dark = new Set<string>();
  for (let row = 0; row < count; row++) {
    for (let col = 0; col < count; col++) {
      if (qr.isDark(row, col)) dark.add(`${col + QUIET_ZONE},${row + QUIET_ZONE}`);
    }
  }
  return dark;
}

/** The viewBox edge length, in modules. */
function gridSize(svg: string): number {
  return Number(/viewBox="0 0 (\d+)/.exec(svg)![1]);
}

describe('qrSvg', () => {
  describe('given a payment URI', () => {
    it('encodes a real ZIP-321 URI', () => {
      const uri = buildPaymentUri({ address: UA, zecAmount: 0.05732841 })!;
      const svg = qrSvg(uri)!;
      expect(svg.startsWith('<svg')).toBe(true);
      expect(svg).toContain('</svg>');
    });

    it('draws exactly the dark modules the encoder produced', () => {
      // A grid that differs from the encoder's by a single module is either
      // unscannable or, far worse, scannable as a different payment request.
      const uri = buildPaymentUri({ address: UA, zecAmount: 0.05732841 })!;
      expect(drawnModules(qrSvg(uri)!)).toEqual(encodedModules(uri));
    });

    it('leaves the quiet zone scanners need', () => {
      // Below four modules of margin, many scanners simply fail.
      const svg = qrSvg('zcash:test')!;
      const viewBox = /viewBox="0 0 (\d+) (\d+)"/.exec(svg)!;
      const total = Number(viewBox[1]);
      // Smallest QR is 21 modules; with 4 either side that is at least 29.
      expect(total).toBeGreaterThanOrEqual(29);
    });

    it('holds the code four modules clear of every edge', () => {
      // The margin only exists if the grid is offset into it. Drawn at the
      // origin instead, the viewBox would be wide enough and still unreadable.
      const svg = qrSvg('zcash:test')!;
      const edges = [...drawnModules(svg)].flatMap((key) => key.split(',').map(Number));
      // Both corner finder patterns are dark, so these are the grid's extremes.
      expect(Math.min(...edges)).toBe(QUIET_ZONE);
      expect(Math.max(...edges)).toBe(gridSize(svg) - QUIET_ZONE - 1);
    });

    it('paints the background across the quiet zone as well', () => {
      // A QR with a transparent margin sits on whatever the page is; over a
      // dark background the quiet zone stops being quiet.
      const svg = qrSvg('zcash:test')!;
      const total = gridSize(svg);
      expect(svg).toContain(`<rect width="${total}" height="${total}"`);
    });

    it('carries an accessible label', () => {
      expect(qrSvg('zcash:test')).toContain('aria-label="Payment request QR code"');
    });
  });

  describe('when no colours are given', () => {
    it('falls back to black on white', () => {
      // Scanners are unforgiving about contrast, so the default has to be the
      // strongest pair available rather than anything inherited.
      const svg = qrSvg('zcash:test')!;
      expect(svg).toMatch(/<rect [^>]*fill="#ffffff"\/>/);
      expect(svg).toMatch(/<path [^>]*fill="#000000"\/>/);
    });
  });

  describe('when a size is given', () => {
    it('scales without blurring, because it is vector', () => {
      const small = qrSvg('zcash:test', { size: 120 })!;
      const large = qrSvg('zcash:test', { size: 480 })!;
      // Same module grid, different rendered size — no re-encoding, no blur.
      const grid = (svg: string) => /viewBox="0 0 (\d+)/.exec(svg)![1];
      expect(grid(small)).toBe(grid(large));
      expect(small).toContain('width="120"');
      expect(large).toContain('width="480"');
    });
  });

  describe('given more data', () => {
    it('grows with the amount of data, as a QR must', () => {
      const short = qrSvg('zcash:a')!;
      const long = qrSvg(
        buildPaymentUri({
          address: UA,
          zecAmount: 1,
          message: 'A reasonably long note about what this payment is for',
        })!,
      )!;
      const grid = (svg: string) => Number(/viewBox="0 0 (\d+)/.exec(svg)![1]);
      expect(grid(long)).toBeGreaterThan(grid(short));
    });
  });

  describe('given input it cannot encode', () => {
    it('returns null on empty input', () => {
      // No QR is recoverable; a malformed one is not.
      expect(qrSvg('')).toBeNull();
    });

    it('returns null on input too large for any version', () => {
      expect(qrSvg('x'.repeat(10_000))).toBeNull();
    });
  });
});
