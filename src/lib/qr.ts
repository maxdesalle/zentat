import qrcode from 'qrcode-generator';

/**
 * QR rendering for ZIP-321 payment requests.
 *
 * Rendered as inline SVG rather than a canvas: it scales to any size without
 * blurring, needs no 2D context (so it works in an offscreen or extension
 * page without fuss), and can be copied or printed. A blurry payment QR is a
 * QR that does not scan.
 *
 * The encoder is pinned exactly and covered by the build-time hash gate in
 * scripts/verify-vendored.mjs, on the same reasoning as the Nym WASM: a
 * dependency that renders payment instructions is worth checking the bytes of.
 */

/** Error-correction level. M tolerates ~15% damage — the usual choice. */
const ERROR_CORRECTION = 'M' as const;

/** Quiet zone, in modules. Below 4 many scanners fail; the spec says 4. */
const QUIET_ZONE = 4;

export interface QrOptions {
  /** Rendered edge length in CSS pixels. */
  size?: number;
  /** Dark module colour. Keep the contrast high — scanners are unforgiving. */
  foreground?: string;
  background?: string;
}

/**
 * Encode text as an SVG string.
 *
 * Returns null rather than throwing: the caller is showing a payment request,
 * and no QR is a recoverable state while a malformed one is not.
 */
export function qrSvg(text: string, options: QrOptions = {}): string | null {
  if (!text) return null;

  const { size = 220, foreground = '#000000', background = '#ffffff' } = options;

  try {
    // Type 0 asks the library to pick the smallest version that fits.
    const qr = qrcode(0, ERROR_CORRECTION);
    qr.addData(text);
    qr.make();

    const count = qr.getModuleCount();
    const total = count + QUIET_ZONE * 2;

    // One path for every dark module, which keeps the SVG small and lets it
    // scale losslessly.
    let path = '';
    for (let row = 0; row < count; row++) {
      for (let col = 0; col < count; col++) {
        if (qr.isDark(row, col)) {
          path += `M${col + QUIET_ZONE} ${row + QUIET_ZONE}h1v1h-1z`;
        }
      }
    }

    return [
      `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}"`,
      ` viewBox="0 0 ${total} ${total}" shape-rendering="crispEdges"`,
      ` role="img" aria-label="Payment request QR code">`,
      `<rect width="${total}" height="${total}" fill="${background}"/>`,
      `<path d="${path}" fill="${foreground}"/>`,
      `</svg>`,
    ].join('');
  } catch {
    // Overlong input, or anything the encoder refuses.
    return null;
  }
}
