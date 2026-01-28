/**
 * Utility Functions Tests
 *
 * Unit tests for the utility functions in utils.ts
 */

import { cn, formatBytes, formatUptime, formatStatus, debounce, sleep } from "../utils";

describe("cn (classname merge)", () => {
  it("should merge multiple class names", () => {
    expect(cn("foo", "bar")).toBe("foo bar");
  });

  it("should handle conditional classes", () => {
    const isActive = true;
    const isDisabled = false;
    expect(cn("base", isActive && "active", isDisabled && "disabled")).toBe(
      "base active",
    );
  });

  it("should handle arrays of class names", () => {
    expect(cn(["foo", "bar"])).toBe("foo bar");
  });

  it("should handle object syntax", () => {
    expect(cn({ foo: true, bar: false, baz: true })).toBe("foo baz");
  });

  it("should handle empty inputs", () => {
    expect(cn()).toBe("");
    expect(cn("")).toBe("");
  });

  it("should filter out falsy values", () => {
    expect(cn("foo", null, undefined, false, "bar")).toBe("foo bar");
  });
});

describe("formatBytes", () => {
  it("should format 0 bytes", () => {
    expect(formatBytes(0)).toBe("0 B");
  });

  it("should format undefined as 0 B", () => {
    expect(formatBytes(undefined)).toBe("0 B");
  });

  it("should format bytes correctly", () => {
    expect(formatBytes(500)).toBe("500 B");
  });

  it("should format kilobytes correctly", () => {
    expect(formatBytes(1024)).toBe("1 KB");
    expect(formatBytes(1536)).toBe("1.5 KB");
  });

  it("should format megabytes correctly", () => {
    expect(formatBytes(1048576)).toBe("1 MB");
    expect(formatBytes(1572864)).toBe("1.5 MB");
  });

  it("should format gigabytes correctly", () => {
    expect(formatBytes(1073741824)).toBe("1 GB");
  });

  it("should respect decimal parameter", () => {
    expect(formatBytes(1536, 2)).toBe("1.5 KB");
    expect(formatBytes(1536, 0)).toBe("2 KB");
  });

  it("should handle large file sizes", () => {
    // 2.5 GB
    expect(formatBytes(2684354560)).toBe("2.5 GB");
  });
});

describe("formatUptime", () => {
  it("should return -- for undefined", () => {
    expect(formatUptime(undefined)).toBe("--");
  });

  it("should return -- for 0", () => {
    expect(formatUptime(0)).toBe("--");
  });

  it("should format minutes only", () => {
    expect(formatUptime(120)).toBe("2m");
    expect(formatUptime(300)).toBe("5m");
  });

  it("should format hours and minutes", () => {
    expect(formatUptime(3660)).toBe("1h 1m");
    expect(formatUptime(7200)).toBe("2h 0m");
  });

  it("should format days and hours", () => {
    expect(formatUptime(86400)).toBe("1d 0h");
    expect(formatUptime(90000)).toBe("1d 1h");
  });

  it("should handle large uptimes", () => {
    // 7 days, 12 hours
    expect(formatUptime(648000)).toBe("7d 12h");
  });
});

describe("formatStatus", () => {
  it("should format 'active' as Available", () => {
    expect(formatStatus("active")).toBe("Available");
  });

  it("should format 'available' as Available", () => {
    expect(formatStatus("available")).toBe("Available");
  });

  it("should format 'away' as Away", () => {
    expect(formatStatus("away")).toBe("Away");
  });

  it("should format 'inactive' as Away", () => {
    expect(formatStatus("inactive")).toBe("Away");
  });

  it("should format 'busy' as In a Call", () => {
    expect(formatStatus("busy")).toBe("In a Call");
  });

  it("should format 'call' as In a Call", () => {
    expect(formatStatus("call")).toBe("In a Call");
  });

  it("should format 'meeting' as In a Call", () => {
    expect(formatStatus("meeting")).toBe("In a Call");
  });

  it("should format 'dnd' as Do Not Disturb", () => {
    expect(formatStatus("dnd")).toBe("Do Not Disturb");
  });

  it("should format 'donotdisturb' as Do Not Disturb", () => {
    expect(formatStatus("donotdisturb")).toBe("Do Not Disturb");
  });

  it("should format 'ooo' as Out of Office", () => {
    expect(formatStatus("ooo")).toBe("Out of Office");
  });

  it("should format 'outofoffice' as Out of Office", () => {
    expect(formatStatus("outofoffice")).toBe("Out of Office");
  });

  it("should format 'offline' as Offline", () => {
    expect(formatStatus("offline")).toBe("Offline");
  });

  it("should format 'unknown' as Unknown", () => {
    expect(formatStatus("unknown")).toBe("Unknown");
  });

  it("should be case insensitive", () => {
    expect(formatStatus("ACTIVE")).toBe("Available");
    expect(formatStatus("Away")).toBe("Away");
    expect(formatStatus("DND")).toBe("Do Not Disturb");
  });

  it("should return original status for unknown values", () => {
    expect(formatStatus("custom-status")).toBe("custom-status");
  });

  it("should return Unknown for undefined", () => {
    expect(formatStatus(undefined)).toBe("Unknown");
  });
});

describe("debounce", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("should delay function execution", () => {
    const func = jest.fn();
    const debouncedFunc = debounce(func, 100);

    debouncedFunc();
    expect(func).not.toHaveBeenCalled();

    jest.advanceTimersByTime(100);
    expect(func).toHaveBeenCalledTimes(1);
  });

  it("should only call function once for rapid calls", () => {
    const func = jest.fn();
    const debouncedFunc = debounce(func, 100);

    debouncedFunc();
    debouncedFunc();
    debouncedFunc();
    debouncedFunc();

    jest.advanceTimersByTime(100);
    expect(func).toHaveBeenCalledTimes(1);
  });

  it("should pass arguments to the debounced function", () => {
    const func = jest.fn();
    const debouncedFunc = debounce(func, 100);

    debouncedFunc("arg1", "arg2");
    jest.advanceTimersByTime(100);

    expect(func).toHaveBeenCalledWith("arg1", "arg2");
  });

  it("should use the last arguments when called multiple times", () => {
    const func = jest.fn();
    const debouncedFunc = debounce(func, 100);

    debouncedFunc("first");
    debouncedFunc("second");
    debouncedFunc("third");

    jest.advanceTimersByTime(100);
    expect(func).toHaveBeenCalledWith("third");
  });

  it("should reset the delay on each call", () => {
    const func = jest.fn();
    const debouncedFunc = debounce(func, 100);

    debouncedFunc();
    jest.advanceTimersByTime(50);
    expect(func).not.toHaveBeenCalled();

    debouncedFunc();
    jest.advanceTimersByTime(50);
    expect(func).not.toHaveBeenCalled();

    jest.advanceTimersByTime(50);
    expect(func).toHaveBeenCalledTimes(1);
  });
});

describe("sleep", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("should return a promise", () => {
    const result = sleep(100);
    expect(result).toBeInstanceOf(Promise);
  });

  it("should resolve after the specified time", async () => {
    const callback = jest.fn();
    sleep(100).then(callback);

    expect(callback).not.toHaveBeenCalled();
    jest.advanceTimersByTime(100);
    await Promise.resolve();
    expect(callback).toHaveBeenCalled();
  });
});
