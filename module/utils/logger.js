export const MODULE_ID = "pf2e-points-tracker";

const prefix = "PF2e Points Tracker |";

export const logger = {
  debug(...args) {
    if (!globalThis.CONFIG?.debug?.pf2ePointsTracker) return;
    console.debug(prefix, ...args);
  },
  info(...args) {
    console.info(prefix, ...args);
  },
  warn(...args) {
    console.warn(prefix, ...args);
  },
  error(...args) {
    console.error(prefix, ...args);
  },
};
