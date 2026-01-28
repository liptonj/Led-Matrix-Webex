/**
 * Device Store Tests
 *
 * Unit tests for the DeviceStore class covering:
 * - Initialization and loading
 * - Device registration and updates
 * - Persistence and shutdown
 * - Error handling
 */

import * as fs from "fs";
import * as path from "path";
import { createLogger, transports } from "winston";

// Create a silent test logger
const logger = createLogger({
  level: "error",
  transports: [new transports.Console({ silent: true })],
});

// Mock fs module
jest.mock("fs");
const mockFs = fs as jest.Mocked<typeof fs>;

// Test data directory
const TEST_DATA_DIR = "/tmp/test-devices";
const TEST_FILE_PATH = path.join(TEST_DATA_DIR, "devices.json");

// Helper to create a fresh DeviceStore instance
// Uses jest.isolateModules to ensure fresh DEFAULT_DATA
function createFreshStore(): Promise<InstanceType<any>> {
  return new Promise((resolve) => {
    jest.isolateModules(() => {
      const { DeviceStore } = require("../device_store");
      const store = new DeviceStore(TEST_DATA_DIR, logger);
      resolve(store);
    });
  });
}

describe("DeviceStore", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();

    // Default mock implementations
    mockFs.existsSync.mockReturnValue(false);
    mockFs.readFileSync.mockReturnValue("");
    mockFs.writeFileSync.mockImplementation(() => {});
    mockFs.mkdirSync.mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe("constructor", () => {
    it("should create instance with correct file path", async () => {
      const store = await createFreshStore();

      expect(store).toBeDefined();
      expect(store.getDeviceCount()).toBe(0);
    });

    it("should initialize with empty data", async () => {
      const store = await createFreshStore();

      expect(store.getAllDevices()).toEqual([]);
      expect(store.getDeviceCount()).toBe(0);
    });
  });

  describe("load", () => {
    it("should load devices from existing file", async () => {
      const existingData = {
        version: 1,
        devices: {
          "device-123": {
            deviceId: "device-123",
            displayName: "Test Device",
            pairingCode: "ABC123",
            registeredAt: "2024-01-01T00:00:00.000Z",
            lastSeen: "2024-01-02T00:00:00.000Z",
            ipAddress: "192.168.1.100",
            firmwareVersion: "1.0.0",
          },
        },
        pairingCodes: {
          ABC123: "device-123",
        },
      };

      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(JSON.stringify(existingData));

      const store = await createFreshStore();
      await store.load();

      expect(store.getDeviceCount()).toBe(1);
      expect(store.getDevice("device-123")).toBeDefined();
      expect(store.getDevice("device-123")?.displayName).toBe("Test Device");
    });

    it("should handle file not found gracefully", async () => {
      mockFs.existsSync.mockReturnValue(false);

      const store = await createFreshStore();
      await store.load();

      expect(store.getDeviceCount()).toBe(0);
      expect(store.getAllDevices()).toEqual([]);
    });

    it("should handle corrupt JSON gracefully", async () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue("{ invalid json }}}");

      const store = await createFreshStore();
      await store.load();

      // Should start fresh on corruption
      expect(store.getDeviceCount()).toBe(0);
    });

    it("should handle version mismatch by starting fresh", async () => {
      const oldVersionData = {
        version: 0, // Different version
        devices: {
          "device-123": {
            deviceId: "device-123",
            displayName: "Old Device",
            pairingCode: "OLD001",
            registeredAt: "2024-01-01T00:00:00.000Z",
            lastSeen: "2024-01-02T00:00:00.000Z",
          },
        },
        pairingCodes: {
          OLD001: "device-123",
        },
      };

      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(JSON.stringify(oldVersionData));

      const store = await createFreshStore();
      await store.load();

      // Should start fresh due to version mismatch
      expect(store.getDeviceCount()).toBe(0);
    });
  });

  describe("registerDevice", () => {
    it("should register new device with correct fields", async () => {
      const store = await createFreshStore();

      const device = store.registerDevice(
        "device-123",
        "ABC123",
        "My Display",
        "192.168.1.100",
        "1.0.0",
      );

      expect(device).toBeDefined();
      expect(device.deviceId).toBe("device-123");
      expect(device.displayName).toBe("My Display");
      expect(device.pairingCode).toBe("ABC123");
      expect(device.ipAddress).toBe("192.168.1.100");
      expect(device.firmwareVersion).toBe("1.0.0");
      expect(device.registeredAt).toBeDefined();
      expect(device.lastSeen).toBeDefined();
    });

    it("should update existing device without duplicating", async () => {
      const store = await createFreshStore();

      // Register first time
      store.registerDevice("device-123", "ABC123", "Original Name");
      expect(store.getDeviceCount()).toBe(1);

      // Update same device
      const updated = store.registerDevice(
        "device-123",
        "XYZ789", // New code
        "Updated Name",
        "192.168.1.200",
        "2.0.0",
      );

      expect(store.getDeviceCount()).toBe(1); // Still 1 device
      expect(updated.displayName).toBe("Updated Name");
      expect(updated.pairingCode).toBe("XYZ789");
      expect(updated.ipAddress).toBe("192.168.1.200");
    });

    it("should generate default display name if not provided", async () => {
      const store = await createFreshStore();

      const device = store.registerDevice("device-abcd1234", "ABC123");

      // Should use last 4 characters of deviceId
      expect(device.displayName).toBe("Display 1234");
    });

    it("should preserve existing display name on update if not provided", async () => {
      const store = await createFreshStore();

      store.registerDevice("device-123", "ABC123", "My Custom Name");

      // Update without display name
      const updated = store.registerDevice(
        "device-123",
        "XYZ789",
        undefined,
        "192.168.1.200",
      );

      expect(updated.displayName).toBe("My Custom Name");
    });

    it("should update pairing code mapping when code changes", async () => {
      const store = await createFreshStore();

      store.registerDevice("device-123", "ABC123");
      expect(store.getDeviceByCode("ABC123")).toBeDefined();

      // Update with new code
      store.registerDevice("device-123", "XYZ789");

      expect(store.getDeviceByCode("ABC123")).toBeUndefined();
      expect(store.getDeviceByCode("XYZ789")).toBeDefined();
    });
  });

  describe("getDevice", () => {
    it("should return device by ID", async () => {
      const store = await createFreshStore();
      store.registerDevice("device-123", "ABC123", "Test Device");

      const device = store.getDevice("device-123");

      expect(device).toBeDefined();
      expect(device?.deviceId).toBe("device-123");
    });

    it("should return undefined for non-existent device", async () => {
      const store = await createFreshStore();

      const device = store.getDevice("non-existent");

      expect(device).toBeUndefined();
    });
  });

  describe("getDeviceByCode", () => {
    it("should return device by pairing code", async () => {
      const store = await createFreshStore();
      store.registerDevice("device-123", "ABC123", "Test Device");

      const device = store.getDeviceByCode("ABC123");

      expect(device).toBeDefined();
      expect(device?.pairingCode).toBe("ABC123");
    });

    it("should be case-insensitive", async () => {
      const store = await createFreshStore();
      store.registerDevice("device-123", "ABC123");

      expect(store.getDeviceByCode("abc123")).toBeDefined();
      expect(store.getDeviceByCode("Abc123")).toBeDefined();
    });

    it("should return undefined for non-existent code", async () => {
      const store = await createFreshStore();

      const device = store.getDeviceByCode("NONEXIST");

      expect(device).toBeUndefined();
    });
  });

  describe("getAllDevices", () => {
    it("should return all registered devices", async () => {
      const store = await createFreshStore();

      store.registerDevice("device-1", "CODE01", "Device 1");
      store.registerDevice("device-2", "CODE02", "Device 2");
      store.registerDevice("device-3", "CODE03", "Device 3");

      const devices = store.getAllDevices();

      expect(devices).toHaveLength(3);
      const deviceIds = devices.map((d: any) => d.deviceId).sort();
      expect(deviceIds).toEqual(["device-1", "device-2", "device-3"]);
    });

    it("should return empty array when no devices", async () => {
      const store = await createFreshStore();

      expect(store.getAllDevices()).toEqual([]);
    });
  });

  describe("updateLastSeen", () => {
    it("should update lastSeen timestamp", async () => {
      const store = await createFreshStore();
      store.registerDevice("device-123", "ABC123");

      const initialLastSeen = store.getDevice("device-123")?.lastSeen;

      // Advance time
      jest.advanceTimersByTime(1000);

      store.updateLastSeen("device-123");

      const updatedLastSeen = store.getDevice("device-123")?.lastSeen;
      expect(updatedLastSeen).not.toBe(initialLastSeen);
    });

    it("should update IP address if provided", async () => {
      const store = await createFreshStore();
      store.registerDevice("device-123", "ABC123", undefined, "192.168.1.100");

      store.updateLastSeen("device-123", "192.168.1.200");

      expect(store.getDevice("device-123")?.ipAddress).toBe("192.168.1.200");
    });

    it("should do nothing for non-existent device", async () => {
      const store = await createFreshStore();

      // Should not throw
      expect(() => store.updateLastSeen("non-existent")).not.toThrow();
    });
  });

  describe("isCodeInUse", () => {
    it("should return true for used code", async () => {
      const store = await createFreshStore();
      store.registerDevice("device-123", "ABC123");

      expect(store.isCodeInUse("ABC123")).toBe(true);
    });

    it("should be case-insensitive", async () => {
      const store = await createFreshStore();
      store.registerDevice("device-123", "ABC123");

      expect(store.isCodeInUse("abc123")).toBe(true);
    });

    it("should return false for unused code", async () => {
      const store = await createFreshStore();

      expect(store.isCodeInUse("UNUSED")).toBe(false);
    });
  });

  describe("removeDevice", () => {
    it("should remove device and pairing code", async () => {
      const store = await createFreshStore();

      store.registerDevice("device-to-remove", "REMOVE01");
      expect(store.getDeviceCount()).toBe(1);

      expect(store.removeDevice("device-to-remove")).toBe(true);
      expect(store.getDevice("device-to-remove")).toBeUndefined();
      expect(store.getDeviceByCode("REMOVE01")).toBeUndefined();
      expect(store.getDeviceCount()).toBe(0);
    });

    it("should return false for non-existent device", async () => {
      const store = await createFreshStore();

      expect(store.removeDevice("non-existent")).toBe(false);
    });
  });

  describe("setDisplayName", () => {
    it("should update display name", async () => {
      const store = await createFreshStore();
      store.registerDevice("device-123", "ABC123", "Original");

      expect(store.setDisplayName("device-123", "New Name")).toBe(true);
      expect(store.getDevice("device-123")?.displayName).toBe("New Name");
    });

    it("should return false for non-existent device", async () => {
      const store = await createFreshStore();

      expect(store.setDisplayName("non-existent", "Name")).toBe(false);
    });
  });

  describe("save (debounced)", () => {
    it("should debounce saves", async () => {
      mockFs.existsSync.mockReturnValue(true);

      const store = await createFreshStore();

      // Register multiple devices rapidly
      store.registerDevice("device-1", "CODE01");
      store.registerDevice("device-2", "CODE02");
      store.registerDevice("device-3", "CODE03");

      // Should not have saved yet (debounced)
      expect(mockFs.writeFileSync).not.toHaveBeenCalled();

      // Advance past debounce timeout (1000ms)
      jest.advanceTimersByTime(1100);

      // Now it should have saved once
      expect(mockFs.writeFileSync).toHaveBeenCalledTimes(1);
    });
  });

  describe("saveNow", () => {
    it("should save immediately when dirty", async () => {
      mockFs.existsSync.mockReturnValue(true);

      const store = await createFreshStore();
      store.registerDevice("device-123", "ABC123");

      store.saveNow();

      expect(mockFs.writeFileSync).toHaveBeenCalledWith(
        TEST_FILE_PATH,
        expect.any(String),
      );
    });

    it("should not save when not dirty", async () => {
      const store = await createFreshStore();

      // No changes made
      store.saveNow();

      expect(mockFs.writeFileSync).not.toHaveBeenCalled();
    });

    it("should create directory if it does not exist", async () => {
      mockFs.existsSync.mockImplementation((p) => {
        // File exists check returns true, dir exists check returns false
        return p === TEST_FILE_PATH;
      });

      const store = await createFreshStore();
      store.registerDevice("device-123", "ABC123");

      store.saveNow();

      expect(mockFs.mkdirSync).toHaveBeenCalledWith(TEST_DATA_DIR, {
        recursive: true,
      });
    });

    it("should handle write errors gracefully", async () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.writeFileSync.mockImplementation(() => {
        throw new Error("Write failed");
      });

      const store = await createFreshStore();
      store.registerDevice("device-123", "ABC123");

      // Should not throw
      expect(() => store.saveNow()).not.toThrow();
    });
  });

  describe("shutdown", () => {
    it("should save pending changes and clear timeout", async () => {
      mockFs.existsSync.mockReturnValue(true);

      const store = await createFreshStore();
      store.registerDevice("device-123", "ABC123");

      // Shutdown before debounce fires
      await store.shutdown();

      expect(mockFs.writeFileSync).toHaveBeenCalled();
    });

    it("should handle shutdown with no pending changes", async () => {
      const store = await createFreshStore();

      // Should not throw
      await expect(store.shutdown()).resolves.toBeUndefined();
    });
  });
});
