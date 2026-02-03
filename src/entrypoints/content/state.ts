// Shared state for content script modules

// Flag to suppress observer during our own conversions
// This prevents re-processing converted text (e.g., "4.095 thousand ZEC")
export let isConverting = false;

export function setConverting(value: boolean): void {
  isConverting = value;
}
