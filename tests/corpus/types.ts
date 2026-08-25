/**
 * The golden corpus.
 *
 * This product's correctness is empirical. It either reads a real page's
 * markup right or it does not, and every site redesign silently breaks it —
 * with no telemetry to notice, by design. Unit tests pin the parser against
 * strings someone imagined; only saved real markup pins it against the web.
 *
 * Expectations are anchored on CONTENT, not on DOM position: selectors rot on
 * every re-capture, price strings do not.
 */

export interface ExpectedPrice {
  /** The price as it appears to a reader. */
  text: string;
  currency: string;
  amount: number;
  /** How many times it should be found. Catches over-conversion. */
  count?: number;
}

export interface Fixture {
  name: string;
  hostname: string;
  lang?: string;
  html: string;

  /** Prices that must be found, as a multiset. */
  expect: ExpectedPrice[];

  /**
   * Strings that must NEVER be read as a price. Equally important and usually
   * missing: a false positive looks worse to a user than a miss.
   */
  forbid?: string[];

  /**
   * Known misses, with the reason. This is what stops a corpus rotting into a
   * permanently-red suite nobody reads. An acknowledged gap passes; a gap that
   * starts PASSING fails loudly, so fixing something by accident is visible.
   */
  knownGaps?: Array<{ text: string; why: string }>;
}
