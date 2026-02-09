/**
 * Environment-aware logging utility.
 * Debug and info logs are suppressed in production.
 * Warnings and errors always log.
 */

const isDev = process.env.NODE_ENV !== 'production';

export const logger = {
  /**
   * Debug logging - only in development
   */
  debug: (...args: unknown[]): void => {
    if (isDev) console.log('[DEBUG]', ...args);
  },

  /**
   * Info logging - only in development
   */
  info: (...args: unknown[]): void => {
    if (isDev) console.log('[INFO]', ...args);
  },

  /**
   * Warning logging - always logs
   */
  warn: (...args: unknown[]): void => {
    console.warn('[WARN]', ...args);
  },

  /**
   * Error logging - always logs
   */
  error: (...args: unknown[]): void => {
    console.error('[ERROR]', ...args);
  },
};

export default logger;
