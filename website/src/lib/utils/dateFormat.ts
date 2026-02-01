/**
 * Formats a timestamp as a relative time string (e.g., "5m ago", "2h ago", "3d ago")
 * Used for displaying command age and other relative time displays
 */
export function formatRelativeTime(timestamp: string | Date): string {
  const date = typeof timestamp === "string" ? new Date(timestamp) : timestamp;
  const deltaMs = Date.now() - date.getTime();
  const minutes = Math.max(0, Math.floor(deltaMs / 60000));

  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

/**
 * Formats a timestamp as an absolute date/time string
 * Optionally includes time based on the includeTime parameter
 */
export function formatAbsoluteDate(
  timestamp: string | Date,
  options?: {
    includeTime?: boolean;
    includeSeconds?: boolean;
  },
): string {
  const date = typeof timestamp === "string" ? new Date(timestamp) : timestamp;
  const { includeTime = true, includeSeconds = false } = options ?? {};

  const dateStr = date.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });

  if (!includeTime) return dateStr;

  const timeOptions: Intl.DateTimeFormatOptions = {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  };

  if (includeSeconds) {
    timeOptions.second = "2-digit";
  }

  const timeStr = date.toLocaleTimeString("en-US", timeOptions);

  return `${dateStr} at ${timeStr}`;
}

/**
 * Formats duration in milliseconds to a human-readable string
 */
export function formatDuration(durationMs: number): string {
  const seconds = Math.floor(durationMs / 1000);

  if (seconds < 60) return `${seconds}s`;

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    const remainingSeconds = seconds % 60;
    return remainingSeconds > 0
      ? `${minutes}m ${remainingSeconds}s`
      : `${minutes}m`;
  }

  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    const remainingMinutes = minutes % 60;
    return remainingMinutes > 0 ? `${hours}h ${remainingMinutes}m` : `${hours}h`;
  }

  const days = Math.floor(hours / 24);
  const remainingHours = hours % 24;
  return remainingHours > 0 ? `${days}d ${remainingHours}h` : `${days}d`;
}

/**
 * Formats uptime in seconds to a human-readable string
 */
export function formatUptime(uptimeSeconds: number): string {
  return formatDuration(uptimeSeconds * 1000);
}
