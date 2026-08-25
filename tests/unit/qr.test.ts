import { describe, expect, it } from 'vitest';
import { qrSvg } from '../../src/lib/qr';
import { buildPaymentUri } from '../../src/lib/zip321';

const UA = 'u1' + 'a'.repeat(60);

describe('payment QR', () => {
  it('encodes a real ZIP-321 URI', () => {
    const uri = buildPaymentUri({ address: UA, zecAmount: 0.05732841 })!;
    const svg = qrSvg(uri)!;
    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg).toContain('</svg>');
  });

  it('leaves the quiet zone scanners need', () => {
    // Below four modules of margin, many scanners simply fail.
    const svg = qrSvg('zcash:test')!;
    const viewBox = /viewBox="0 0 (\d+) (\d+)"/.exec(svg)!;
    const total = Number(viewBox[1]);
    // Smallest QR is 21 modules; with 4 either side that is at least 29.
    expect(total).toBeGreaterThanOrEqual(29);
  });

  it('scales without blurring, because it is vector', () => {
    const small = qrSvg('zcash:test', { size: 120 })!;
    const large = qrSvg('zcash:test', { size: 480 })!;
    // Same module grid, different rendered size — no re-encoding, no blur.
    const grid = (svg: string) => /viewBox="0 0 (\d+)/.exec(svg)![1];
    expect(grid(small)).toBe(grid(large));
    expect(small).toContain('width="120"');
    expect(large).toContain('width="480"');
  });

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

  it('carries an accessible label', () => {
    expect(qrSvg('zcash:test')).toContain('aria-label="Payment request QR code"');
  });

  it('returns null rather than throwing on input it cannot encode', () => {
    // No QR is recoverable; a malformed one is not.
    expect(qrSvg('')).toBeNull();
    expect(qrSvg('x'.repeat(10_000))).toBeNull();
  });
});
