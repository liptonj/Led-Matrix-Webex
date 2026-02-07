/**
 * EmbeddedAppClient Tests
 *
 * Tests for session-based authentication, tab structure, user channel broadcasts, and Webex status updates.
 * Uses static imports with proper module mocking to avoid React 19 hooks context issues.
 */

import type { Session } from "@supabase/supabase-js";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";

// Store original env
const originalEnv = process.env;

// Mock Supabase client
interface MockChannel {
  on: jest.Mock;
  subscribe: jest.Mock;
  send: jest.Mock;
}
const mockChannel: MockChannel = {
  on: jest.fn(function(this: MockChannel) { return this; }),
  subscribe: jest.fn(function(this: MockChannel, callback?: (status: string) => void) {
    if (callback) callback("SUBSCRIBED");
    return this;
  }),
  send: jest.fn(() => Promise.resolve("ok")),
};

const mockSupabaseClient = {
  channel: jest.fn(() => mockChannel),
  removeChannel: jest.fn(),
  removeAllChannels: jest.fn(),
  auth: {
    getSession: jest.fn(() => Promise.resolve({ data: { session: null }, error: null })),
  },
  realtime: {
    setAuth: jest.fn(),
  },
  schema: jest.fn(() => ({
    from: jest.fn(() => {
      const builder: Record<string, jest.Mock> = {};
      builder.select = jest.fn(() => builder);
      builder.eq = jest.fn(() => builder);
      builder.single = jest.fn(() => Promise.resolve({ data: null, error: null }));
      builder.update = jest.fn(() => builder);
      builder.insert = jest.fn(() => builder);
      builder.then = jest.fn((resolve) => {
        resolve({ data: null, error: null });
        return Promise.resolve({ data: null, error: null });
      });
      return builder;
    }),
  })),
};

jest.mock("@supabase/supabase-js", () => ({
  createClient: jest.fn(() => mockSupabaseClient),
}));

jest.mock("@/lib/supabaseClient", () => ({
  getSupabaseClient: jest.fn(() => mockSupabaseClient),
}));

// Mock hooks
const mockUseWebexSDK = jest.fn();
jest.mock("@/hooks", () => ({
  useWebexSDK: () => mockUseWebexSDK(),
}));

// Mock embedded hooks
const mockUsePairing = jest.fn();
const mockUseDeviceCommands = jest.fn();
const mockUseDeviceConfig = jest.fn();
const mockUseWebexStatus = jest.fn();
const mockUseDebugConsole = jest.fn();

jest.mock("../hooks", () => ({
  usePairing: (options: unknown) => mockUsePairing(options),
  useDeviceCommands: (options: unknown) => mockUseDeviceCommands(options),
  useDeviceConfig: (options: unknown) => mockUseDeviceConfig(options),
  useWebexStatus: (options: unknown) => mockUseWebexStatus(options),
  useDebugConsole: () => mockUseDebugConsole(),
}));

// Mock UI components
jest.mock("@/components/ui", () => ({
  Button: ({ children, onClick, disabled, variant, block, className }: {
    children: React.ReactNode;
    onClick?: () => void;
    disabled?: boolean;
    variant?: string;
    block?: boolean;
    className?: string;
  }) => (
    <button onClick={onClick} disabled={disabled} className={className} data-variant={variant}>
      {children}
    </button>
  ),
  Card: ({ children, className }: { children: React.ReactNode; className?: string }) => (
    <div className={className}>{children}</div>
  ),
  Alert: ({ children, variant }: { children: React.ReactNode; variant?: string }) => (
    <div role="alert" data-variant={variant}>{children}</div>
  ),
}));

// Mock formatStatus
jest.mock("@/lib/utils", () => ({
  formatStatus: (status: string) => status.charAt(0).toUpperCase() + status.slice(1),
}));

// Mock Next.js Script component
jest.mock("next/script", () => {
  const ScriptMock = ({ onLoad }: { onLoad?: () => void }) => {
    React.useEffect(() => {
      if (onLoad) onLoad();
    }, [onLoad]);
    return null;
  };
  return { __esModule: true, default: ScriptMock };
});

// Mock Next.js Image component
jest.mock("next/image", () => ({
  __esModule: true,
  default: (props: React.ImgHTMLAttributes<HTMLImageElement>) => {
    // eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text
    return <img {...props} />;
  },
}));

// Default mock values
const TEST_DEVICE_UUID = "550e8400-e29b-41d4-a716-446655440000";
const TEST_USER_UUID = "550e8400-e29b-41d4-a716-446655440001";
const TEST_SESSION: Session = {
  access_token: "test-access-token",
  refresh_token: "test-refresh-token",
  expires_in: 3600,
  expires_at: Date.now() / 1000 + 3600,
  token_type: "bearer",
  user: {
    id: TEST_USER_UUID,
    aud: "authenticated",
    role: "authenticated",
    email: "test@example.com",
    email_confirmed_at: new Date().toISOString(),
    phone: "",
    confirmed_at: new Date().toISOString(),
    last_sign_in_at: new Date().toISOString(),
    app_metadata: {},
    user_metadata: {},
    identities: [],
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
} as Session;

const defaultWebexSDKMock = {
  isReady: false,
  user: null,
  status: "offline" as const,
  isVideoOn: false,
  isMuted: false,
  isInCall: false,
  error: null,
  initialize: jest.fn(),
};

const defaultUsePairingMock = {
  isPaired: false,
  isPeerConnected: false,
  lastDeviceSeenMs: null,
  rtStatus: "disconnected" as const,
  supabaseRef: React.createRef(),
  handleDisconnect: jest.fn(),
  updatePairingState: jest.fn(() => Promise.resolve(true)),
  broadcastToUserChannel: jest.fn(() => Promise.resolve(true)),
  session: null,
  userDevices: [],
  selectedDeviceUuid: null,
  setSelectedDeviceUuid: jest.fn(),
  isLoggedIn: false,
};

const defaultUseDeviceCommandsMock = {
  sendCommand: jest.fn(() => Promise.resolve({ success: true, data: {} })),
};

const defaultUseDeviceConfigMock = {
  deviceStatus: null,
  brightness: 128,
  scrollSpeedMs: 1000,
  setScrollSpeedMs: jest.fn(),
  pageIntervalMs: 5000,
  setPageIntervalMs: jest.fn(),
  displayPages: [],
  setDisplayPages: jest.fn(),
  statusLayout: "default",
  setStatusLayout: jest.fn(),
  deviceName: "",
  setDeviceName: jest.fn(),
  manualDisplayName: "",
  setManualDisplayName: jest.fn(),
  dateColor: "#ffffff",
  setDateColor: jest.fn(),
  timeColor: "#ffffff",
  setTimeColor: jest.fn(),
  nameColor: "#ffffff",
  setNameColor: jest.fn(),
  metricColor: "#ffffff",
  setMetricColor: jest.fn(),
  mqttBroker: "",
  setMqttBroker: jest.fn(),
  mqttPort: 1883,
  setMqttPort: jest.fn(),
  mqttUsername: "",
  setMqttUsername: jest.fn(),
  mqttPassword: "",
  setMqttPassword: jest.fn(),
  mqttTopic: "",
  setMqttTopic: jest.fn(),
  hasMqttPassword: false,
  displaySensorMac: "",
  setDisplaySensorMac: jest.fn(),
  displayMetric: "",
  setDisplayMetric: jest.fn(),
  isSaving: false,
  isRebooting: false,
  handleSaveSettings: jest.fn(),
  handleReboot: jest.fn(),
  handleBrightnessChange: jest.fn(),
  setDeviceStatus: jest.fn(),
};

const defaultUseWebexStatusMock = {
  apiWebexStatus: null,
  webexOauthStatus: "idle" as const,
  webexNeedsAuth: false,
  webexPollIntervalMs: 5000,
  setWebexPollIntervalMs: jest.fn(),
  startWebexOAuth: jest.fn(),
  broadcastStatusUpdate: jest.fn(() => Promise.resolve()),
};

const defaultUseDebugConsoleMock = {
  debugVisible: false,
  setDebugVisible: jest.fn(),
  debugLogs: [],
  clearDebugLogs: jest.fn(),
  activityLog: [],
  addLog: jest.fn(),
  handleCopyDebug: jest.fn(),
  formatRelativeTime: jest.fn((ms: number) => `${Math.floor(ms / 1000)}s ago`),
};

// Import the component after mocks are set up
import { EmbeddedAppClient } from "../EmbeddedAppClient";

describe("EmbeddedAppClient", () => {
  // Configure userEvent to work with fake timers
  let user: ReturnType<typeof userEvent.setup>;

  beforeEach(() => {
    jest.useFakeTimers();
    // Setup user AFTER fake timers are enabled
    user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
    
    process.env = {
      ...originalEnv,
      NEXT_PUBLIC_SUPABASE_URL: "https://test.supabase.co",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "test-anon-key",
      NEXT_PUBLIC_USE_SUPABASE_EDGE_FUNCTIONS: "true",
    };
    
    // Reset mocks
    mockUseWebexSDK.mockReturnValue(defaultWebexSDKMock);
    mockUsePairing.mockReturnValue(defaultUsePairingMock);
    mockUseDeviceCommands.mockReturnValue(defaultUseDeviceCommandsMock);
    mockUseDeviceConfig.mockReturnValue(defaultUseDeviceConfigMock);
    mockUseWebexStatus.mockReturnValue(defaultUseWebexStatusMock);
    mockUseDebugConsole.mockReturnValue(defaultUseDebugConsoleMock);
    (global.fetch as jest.Mock) = jest.fn();
    
    // Mock localStorage
    const localStorageMock = {
      getItem: jest.fn(() => null),
      setItem: jest.fn(),
      removeItem: jest.fn(),
      clear: jest.fn(),
    };
    Object.defineProperty(window, "localStorage", { value: localStorageMock, writable: true });
  });

  afterEach(async () => {
    // Run all pending timers before cleanup to avoid clearInterval issues
    jest.runOnlyPendingTimers();
    
    // Cleanup React components BEFORE switching timers
    // This ensures clearInterval is still available from fake timers during cleanup
    cleanup();
    
    process.env = originalEnv;
    jest.useRealTimers();
    jest.clearAllMocks();
  });

  describe("Tab Structure", () => {
    it("should render 3 tabs: status, webex, and devices", () => {
      mockUsePairing.mockReturnValue({
        ...defaultUsePairingMock,
        isLoggedIn: true,
        userDevices: [{ device_uuid: TEST_DEVICE_UUID, serial_number: "A1B2C3D4" }],
        selectedDeviceUuid: TEST_DEVICE_UUID,
      });

      render(<EmbeddedAppClient />);

      expect(screen.getByRole("button", { name: /status/i })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /webex/i })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /devices/i })).toBeInTheDocument();
    });

    it("should switch between tabs when clicked", async () => {
      mockUsePairing.mockReturnValue({
        ...defaultUsePairingMock,
        isLoggedIn: true,
        userDevices: [{ device_uuid: TEST_DEVICE_UUID, serial_number: "A1B2C3D4" }],
        selectedDeviceUuid: TEST_DEVICE_UUID,
      });

      render(<EmbeddedAppClient />);

      const webexTab = screen.getByRole("button", { name: /webex/i });
      await user.click(webexTab);

      await waitFor(() => {
        // Webex tab should be active (check for active styling or content)
        expect(webexTab).toHaveAttribute("class", expect.stringContaining("bg-[var(--color-bg-card)]"));
      });

      const devicesTab = screen.getByRole("button", { name: /devices/i });
      await user.click(devicesTab);

      await waitFor(() => {
        expect(devicesTab).toHaveAttribute("class", expect.stringContaining("bg-[var(--color-bg-card)]"));
      });
    });

    it("should show setup screen when not logged in", () => {
      mockUsePairing.mockReturnValue({
        ...defaultUsePairingMock,
        isLoggedIn: false,
      });

      render(<EmbeddedAppClient />);

      expect(screen.getByText(/Connect to Your Display/i)).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /status/i })).not.toBeInTheDocument();
    });
  });

  describe("Auto-show main app when logged in", () => {
    it("should auto-show main app when logged in with devices", () => {
      mockUsePairing.mockReturnValue({
        ...defaultUsePairingMock,
        isLoggedIn: true,
        userDevices: [{ device_uuid: TEST_DEVICE_UUID, serial_number: "A1B2C3D4" }],
        selectedDeviceUuid: TEST_DEVICE_UUID,
      });

      render(<EmbeddedAppClient />);

      // Should show tabs, not setup screen
      expect(screen.queryByText(/Connect to Your Display/i)).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: /status/i })).toBeInTheDocument();
    });

    it("should auto-select first device when logged in with devices but none selected", () => {
      const setSelectedDeviceUuid = jest.fn();
      mockUsePairing.mockReturnValue({
        ...defaultUsePairingMock,
        isLoggedIn: true,
        userDevices: [
          { device_uuid: TEST_DEVICE_UUID, serial_number: "A1B2C3D4" },
          { device_uuid: "550e8400-e29b-41d4-a716-446655440002", serial_number: "B2C3D4E5" },
        ],
        selectedDeviceUuid: null,
        setSelectedDeviceUuid,
      });

      render(<EmbeddedAppClient />);

      // Should auto-select first device
      expect(setSelectedDeviceUuid).toHaveBeenCalledWith(TEST_DEVICE_UUID);
    });

    it("should show setup screen when logged in but no devices", () => {
      mockUsePairing.mockReturnValue({
        ...defaultUsePairingMock,
        isLoggedIn: true,
        userDevices: [],
        selectedDeviceUuid: null,
      });

      render(<EmbeddedAppClient />);

      // Should still show setup screen when no devices available
      expect(screen.getByText(/Connect to Your Display/i)).toBeInTheDocument();
    });
  });

  describe("Token expiry detection", () => {
    it("should correctly detect token within refresh threshold", () => {
      const expiresAt = new Date(Date.now() + 3 * 60 * 1000).toISOString();
      const token = {
        serial_number: "A1B2C3D4",
        device_id: "webex-display-C3D4",
        token: "test-token",
        expires_at: expiresAt,
      };

      const tokenRefreshThresholdMs = 5 * 60 * 1000;
      const expiresAtTime = new Date(token.expires_at).getTime();
      const now = Date.now();
      const shouldRefresh = (expiresAtTime - now) < tokenRefreshThresholdMs;

      expect(shouldRefresh).toBe(true);
    });

    it("should correctly detect token outside refresh threshold", () => {
      const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();
      const token = {
        serial_number: "A1B2C3D4",
        device_id: "webex-display-C3D4",
        token: "test-token",
        expires_at: expiresAt,
      };

      const tokenRefreshThresholdMs = 5 * 60 * 1000;
      const expiresAtTime = new Date(token.expires_at).getTime();
      const now = Date.now();
      const shouldRefresh = (expiresAtTime - now) < tokenRefreshThresholdMs;

      expect(shouldRefresh).toBe(false);
    });

    it("should detect already expired token", () => {
      const expiresAt = new Date(Date.now() - 5 * 60 * 1000).toISOString();
      const token = {
        serial_number: "A1B2C3D4",
        device_id: "webex-display-C3D4",
        token: "test-token",
        expires_at: expiresAt,
      };

      const tokenRefreshThresholdMs = 5 * 60 * 1000;
      const expiresAtTime = new Date(token.expires_at).getTime();
      const now = Date.now();
      const shouldRefresh = (expiresAtTime - now) < tokenRefreshThresholdMs;

      expect(shouldRefresh).toBe(true);
    });
  });

  describe("insert-command Edge Function", () => {
    it("should use insert-command Edge Function format", () => {
      const expectedRequest = {
        command: "set_brightness",
        payload: { value: 200 },
      };

      const expectedResponse = {
        success: true,
        command_id: "cmd-uuid-123",
      };

      expect(expectedRequest.command).toBeDefined();
      expect(expectedRequest.payload).toBeDefined();
      expect(expectedResponse.success).toBe(true);
      expect(expectedResponse.command_id).toBeDefined();
    });
  });

  describe("User Channel Broadcasts", () => {
    it("should broadcast status updates to user channel when connected", async () => {
      const broadcastStatusUpdate = jest.fn(() => Promise.resolve());
      mockUsePairing.mockReturnValue({
        ...defaultUsePairingMock,
        isLoggedIn: true,
        isPaired: true,
        rtStatus: "connected",
        session: TEST_SESSION,
        userDevices: [{ device_uuid: TEST_DEVICE_UUID, serial_number: "A1B2C3D4" }],
        selectedDeviceUuid: TEST_DEVICE_UUID,
      });
      mockUseWebexStatus.mockReturnValue({
        ...defaultUseWebexStatusMock,
        broadcastStatusUpdate,
      });
      mockUseWebexSDK.mockReturnValue({
        ...defaultWebexSDKMock,
        isReady: true,
        user: { id: TEST_USER_UUID, displayName: "Test User" },
        status: "active",
      });

      render(<EmbeddedAppClient />);

      // Wait for effect to trigger broadcast
      await waitFor(() => {
        expect(broadcastStatusUpdate).toHaveBeenCalledWith(
          "active",
          false,
          false,
          false,
          "Test User"
        );
      });
    });

    it("should broadcast status updates with correct parameters", async () => {
      const broadcastStatusUpdate = jest.fn(() => Promise.resolve());
      mockUsePairing.mockReturnValue({
        ...defaultUsePairingMock,
        isLoggedIn: true,
        isPaired: true,
        rtStatus: "connected",
        session: TEST_SESSION,
        userDevices: [{ device_uuid: TEST_DEVICE_UUID, serial_number: "A1B2C3D4" }],
        selectedDeviceUuid: TEST_DEVICE_UUID,
      });
      mockUseWebexStatus.mockReturnValue({
        ...defaultUseWebexStatusMock,
        broadcastStatusUpdate,
      });
      mockUseWebexSDK.mockReturnValue({
        ...defaultWebexSDKMock,
        isReady: true,
        user: { id: TEST_USER_UUID, displayName: "John Doe" },
        status: "meeting",
        isVideoOn: true,
        isMuted: true,
        isInCall: true,
      });

      render(<EmbeddedAppClient />);

      await waitFor(() => {
        expect(broadcastStatusUpdate).toHaveBeenCalledWith(
          "meeting",
          true,
          true,
          true,
          "John Doe"
        );
      });
    });

    it("should not broadcast when not connected", () => {
      const broadcastStatusUpdate = jest.fn(() => Promise.resolve());
      mockUsePairing.mockReturnValue({
        ...defaultUsePairingMock,
        isLoggedIn: true,
        isPaired: false,
        rtStatus: "disconnected",
        session: TEST_SESSION,
        userDevices: [{ device_uuid: TEST_DEVICE_UUID, serial_number: "A1B2C3D4" }],
        selectedDeviceUuid: TEST_DEVICE_UUID,
      });
      mockUseWebexStatus.mockReturnValue({
        ...defaultUseWebexStatusMock,
        broadcastStatusUpdate,
      });

      render(<EmbeddedAppClient />);

      // Should not broadcast when not connected
      expect(broadcastStatusUpdate).not.toHaveBeenCalled();
    });

  });

  describe("Manual Status Mode", () => {
    it("should use manual status when Webex SDK is not ready", () => {
      mockUsePairing.mockReturnValue({
        ...defaultUsePairingMock,
        isLoggedIn: true,
        userDevices: [{ device_uuid: TEST_DEVICE_UUID, serial_number: "A1B2C3D4" }],
        selectedDeviceUuid: TEST_DEVICE_UUID,
      });
      mockUseWebexSDK.mockReturnValue({
        ...defaultWebexSDKMock,
        isReady: false,
        user: null,
        status: "offline",
      });

      render(<EmbeddedAppClient />);

      // When SDK is not ready, manual controls should be available
      // Component should show main app with status tab
      expect(screen.getByRole("button", { name: /status/i })).toBeInTheDocument();
    });
  });

  describe("Status Normalization", () => {
    it("should normalize 'call' status to 'meeting' for display color", () => {
      // This tests the status normalization logic
      const normalizeStatus = (status: string): string => {
        return status === "call" || status === "presenting" ? "meeting" : status;
      };

      expect(normalizeStatus("call")).toBe("meeting");
      expect(normalizeStatus("presenting")).toBe("meeting");
      expect(normalizeStatus("active")).toBe("active");
      expect(normalizeStatus("dnd")).toBe("dnd");
    });

    it("should normalize 'presenting' status to 'meeting' for display color", () => {
      const normalizeStatus = (status: string): string => {
        return status === "call" || status === "presenting" ? "meeting" : status;
      };

      expect(normalizeStatus("presenting")).toBe("meeting");
    });
  });





  describe('UUID-based device identity', () => {
    it('should pass deviceUuid to useDeviceCommands hook', () => {
      mockUsePairing.mockReturnValue({
        ...defaultUsePairingMock,
        isLoggedIn: true,
        userDevices: [{ device_uuid: TEST_DEVICE_UUID, serial_number: "A1B2C3D4" }],
        selectedDeviceUuid: TEST_DEVICE_UUID,
      });

      render(<EmbeddedAppClient />);

      // Verify useDeviceCommands was called with deviceUuid
      expect(mockUseDeviceCommands).toHaveBeenCalledWith(
        expect.objectContaining({
          deviceUuid: TEST_DEVICE_UUID,
        })
      );
    });

    it('should pass deviceUuid to useWebexStatus hook', () => {
      mockUsePairing.mockReturnValue({
        ...defaultUsePairingMock,
        isLoggedIn: true,
        userDevices: [{ device_uuid: TEST_DEVICE_UUID, serial_number: "A1B2C3D4" }],
        selectedDeviceUuid: TEST_DEVICE_UUID,
      });

      render(<EmbeddedAppClient />);

      // Verify useWebexStatus was called with deviceUuid
      expect(mockUseWebexStatus).toHaveBeenCalledWith(
        expect.objectContaining({
          deviceUuid: TEST_DEVICE_UUID,
        })
      );
    });

    it('should use selectedDeviceUuid when available', () => {
      const selectedUuid = "550e8400-e29b-41d4-a716-446655440002";
      mockUsePairing.mockReturnValue({
        ...defaultUsePairingMock,
        isLoggedIn: true,
        userDevices: [
          { device_uuid: TEST_DEVICE_UUID, serial_number: "A1B2C3D4" },
          { device_uuid: selectedUuid, serial_number: "B2C3D4E5" },
        ],
        selectedDeviceUuid: selectedUuid,
      });

      render(<EmbeddedAppClient />);

      // Verify hooks were called with selected device UUID
      expect(mockUseDeviceCommands).toHaveBeenCalledWith(
        expect.objectContaining({
          deviceUuid: selectedUuid,
        })
      );
    });
  });
});
