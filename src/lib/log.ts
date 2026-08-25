// Debug logging, stripped from production builds.
// console.error stays available everywhere for genuine failures.
export const debug: (...args: unknown[]) => void =
  typeof import.meta !== 'undefined' && import.meta.env?.DEV
    ? console.log.bind(console, 'Zentat:')
    : () => {};
