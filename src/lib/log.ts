// Debug logging, stripped from production builds.
// console.error stays available everywhere for genuine failures.
export const debug: (...args: unknown[]) => void = import.meta.env.DEV
  ? console.log.bind(console, 'Zentat:')
  : () => {};
