// Device status utilities
export {
  getLastSeenValue,
  getLastSeenValueFromMap,
  getLastSeenMs,
  isDeviceOnline,
  isDeviceOnlineFromMap,
  sortDevices,
} from "./deviceStatus";

// Date formatting utilities
export {
  formatRelativeTime,
  formatAbsoluteDate,
  formatDuration,
  formatUptime,
} from "./dateFormat";

// Error handling utilities
export {
  getErrorMessage,
  formatErrorMessage,
  isError,
  hasErrorCode,
  tryCatch,
  tryCatchSync,
} from "./errorHandling";

// Fetch with timeout utilities
export {
  fetchWithTimeout,
  fetchJsonWithTimeout,
  withTimeout,
  TimeoutError,
} from "./fetchWithTimeout";

// Logger utility
export { logger, default as loggerDefault } from "./logger";

// Validation utilities
export { isValidPairingCode } from "./validation";
