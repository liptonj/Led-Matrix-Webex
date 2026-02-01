"use client";

import { useState, useEffect, useCallback, useRef } from "react";

export type WebexStatus =
  | "active"
  | "available"
  | "meeting"
  | "call"
  | "presenting"
  | "busy"
  | "dnd"
  | "donotdisturb"
  | "away"
  | "inactive"
  | "brb"
  | "ooo"
  | "outofoffice"
  | "pending"
  | "offline"
  | "unknown";

export interface WebexUser {
  id: string;
  displayName: string;
  email?: string;
}

export interface WebexMeeting {
  id: string;
  title?: string;
  isActive: boolean;
}

export interface WebexState {
  isInitialized: boolean;
  isReady: boolean;
  user: WebexUser | null;
  status: WebexStatus;
  meeting: WebexMeeting | null;
  isInCall: boolean;
  isMuted: boolean;
  isVideoOn: boolean;
}

export interface UseWebexSDKReturn extends WebexState {
  initialize: () => Promise<void>;
  error: string | null;
}

// Webex SDK types (simplified)
declare global {
  interface Window {
    webex?: {
      Application: {
        new (): WebexApp;
      };
    };
  }
}

// Webex SDK types (simplified) - EAF 2.x compatible
// In EAF 2.x, getUser() is replaced by app.application.states.user (static property)
interface WebexApp {
  onReady: () => Promise<void>;
  context: {
    getMeeting?: () => Promise<{ id: string; title?: string } | null>;
    getSpace?: () => Promise<unknown>;
    getSidebar?: () => Promise<{
      callState?: string;
      isInCall?: boolean;
      inCall?: boolean;
      isInMeeting?: boolean;
    } | null>;
  };
  application: {
    states: {
      user?: {
        id?: string;
        displayName?: string;
        email?: string;
      };
    };
  };
  listen: () => Promise<void>;
  on: (event: string, callback: (data: unknown) => void) => void;
  off: (event: string, callback?: (data: unknown) => void) => void;
}

const initialState: WebexState = {
  isInitialized: false,
  isReady: false,
  user: null,
  status: "unknown",
  meeting: null,
  isInCall: false,
  isMuted: false,
  isVideoOn: false,
};

export function useWebexSDK(): UseWebexSDKReturn {
  const [state, setState] = useState<WebexState>(initialState);
  const [error, setError] = useState<string | null>(null);

  const appRef = useRef<WebexApp | null>(null);
  const mountedRef = useRef(true);
  const sdkTimeoutsRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  const clearSdkTimeouts = useCallback(() => {
    sdkTimeoutsRef.current.forEach((timeoutId) => clearTimeout(timeoutId));
    sdkTimeoutsRef.current = [];
  }, []);

  const updateState = useCallback((updates: Partial<WebexState>) => {
    if (mountedRef.current) {
      setState((prev) => ({ ...prev, ...updates }));
    }
  }, []);

  const handleMeetingEvent = useCallback(
    (data: unknown) => {
      const meetingData = data as {
        id?: string;
        title?: string;
        state?: string;
      };

      if (meetingData.state === "started" || meetingData.state === "joined") {
        updateState({
          meeting: {
            id: meetingData.id || "unknown",
            title: meetingData.title,
            isActive: true,
          },
          status: "meeting",
          isInCall: true,
        });
      } else if (
        meetingData.state === "ended" ||
        meetingData.state === "left"
      ) {
        updateState({
          meeting: null,
          status: "active",
          isInCall: false,
          isMuted: false,
          isVideoOn: false,
        });
      }
    },
    [updateState],
  );

const handleCallEvent = useCallback(
    (data: unknown) => {
      const callData = data as { state?: string };

      if (callData.state === "connected") {
        updateState({
          status: "call",
          isInCall: true,
        });
      } else if (callData.state === "disconnected") {
        updateState({
          status: "active",
          isInCall: false,
        });
      }
    },
    [updateState],
  );

  const handleSidebarCallStateEvent = useCallback(
    (data: unknown) => {
      const sidebarData = data as {
        callState?: string;
        state?: string;
        isInCall?: boolean;
        inCall?: boolean;
        isInMeeting?: boolean;
      };
      const rawState = (sidebarData.callState || sidebarData.state || "").toLowerCase();
      const inCall =
        sidebarData.isInCall === true ||
        sidebarData.inCall === true ||
        sidebarData.isInMeeting === true ||
        rawState === "connected" ||
        rawState === "started" ||
        rawState === "joined" ||
        rawState === "in_call" ||
        rawState === "incall" ||
        rawState === "in_meeting" ||
        rawState === "meeting";

      if (inCall) {
        updateState({
          status: "meeting",
          isInCall: true,
        });
        return;
      }

      if (
        rawState === "disconnected" ||
        rawState === "ended" ||
        rawState === "left" ||
        rawState === "idle" ||
        rawState === "inactive" ||
        rawState === "not_in_call"
      ) {
        updateState({
          status: "active",
          isInCall: false,
        });
      }
    },
    [updateState],
  );

  const handlePresenceEvent = useCallback(
    (data: unknown) => {
      const presenceData = data as { status?: string };
      const statusMap: Record<string, WebexStatus> = {
        active: "active",
        available: "active",
        meeting: "meeting",
        call: "call",
        busy: "busy",
        presenting: "presenting",
        dnd: "dnd",
        donotdisturb: "dnd",
        away: "away",
        inactive: "away",
        brb: "away",
        offline: "offline",
        outofoffice: "ooo",
        ooo: "ooo",
        pending: "pending",
      };

      const newStatus =
        statusMap[presenceData.status?.toLowerCase() || ""] || "unknown";
      updateState({ status: newStatus });
    },
    [updateState],
  );

  // Handle device media events (camera state)
  const handleDeviceMediaEvent = useCallback(
    (data: unknown) => {
      const mediaData = data as { type?: string; state?: string; active?: boolean };
      // device:media:active / device:media:inactive events
      // type could be "video" or "audio"
      if (mediaData.type === "video") {
        const isOn = mediaData.state === "active" || mediaData.active === true;
        updateState({ isVideoOn: isOn });
      }
    },
    [updateState],
  );

  // Handle device audio events (mic state)
  const handleDeviceAudioEvent = useCallback(
    (data: unknown) => {
      const audioData = data as { state?: string; muted?: boolean; active?: boolean };
      // device:audio:active / device:audio:inactive events
      // muted state is inverse of active
      const isMuted = audioData.muted === true || audioData.state === "inactive" || audioData.active === false;
      updateState({ isMuted });
    },
    [updateState],
  );

  // Helper function to wait for SDK with retry logic
  const waitForWebexSDK = useCallback((timeout = 5000): Promise<boolean> => {
    return new Promise((resolve) => {
      const startTime = Date.now();
      let attempts = 0;
      let resolved = false;

      const resolveOnce = (value: boolean) => {
        if (resolved) return;
        resolved = true;
        clearSdkTimeouts();
        resolve(value);
      };

      const checkSDK = () => {
        if (!mountedRef.current) {
          resolveOnce(false);
          return;
        }

        attempts++;

        if (typeof window !== "undefined" && window.webex?.Application) {
          resolveOnce(true);
          return;
        }

        const elapsed = Date.now() - startTime;
        if (elapsed >= timeout) {
          resolveOnce(false);
          return;
        }

        // Exponential backoff: 100ms, 200ms, 400ms, 800ms, 1000ms
        const delay = Math.min(100 * Math.pow(2, attempts - 1), 1000);
        const timeoutId = setTimeout(checkSDK, delay);
        sdkTimeoutsRef.current.push(timeoutId);
      };

      checkSDK();
    });
  }, [clearSdkTimeouts]);

  const initialize = useCallback(async () => {
    if (state.isInitialized || appRef.current) {
      return;
    }

    // Wait for SDK to load with retry logic
    const sdkAvailable = await waitForWebexSDK(5000);

    if (!sdkAvailable || !window.webex?.Application) {
      setError(
        "Webex SDK not available. Make sure you are running inside a Webex embedded app.",
      );
      return;
    }

    try {
      updateState({ isInitialized: true });

      // Create Webex Application instance
      const app = new window.webex.Application();
      appRef.current = app;

      // Wait for app to be ready
      await app.onReady();

      if (!mountedRef.current) return;

      // In EAF 2.x, getUser() is replaced by app.application.states.user (static property)
      // Access user info directly from the application states
      let user: WebexUser | null = null;
      try {
        const userState = app.application?.states?.user;
        if (userState && userState.id) {
          user = {
            id: userState.id,
            displayName: userState.displayName || userState.email || "Unknown User",
            email: userState.email,
          };
        }
      } catch {
        // User info may not be available in all contexts (e.g., certain embedded app contexts)
        // This is expected behavior - app continues normally without user info
      }

      if (!mountedRef.current) return;

      // Get current meeting if available
      let meeting: WebexMeeting | null = null;
      if (app.context.getMeeting) {
        try {
          const meetingData = await app.context.getMeeting();
          if (meetingData) {
            meeting = {
              id: meetingData.id,
              title: meetingData.title,
              isActive: true,
            };
          }
        } catch {
          // No meeting context available
        }
      }

      // Fallback: check sidebar call state if meeting context isn't available
      if (!meeting && app.context.getSidebar) {
        try {
          const sidebarData = await app.context.getSidebar();
          const rawState = (sidebarData?.callState || "").toLowerCase();
          const inCall =
            sidebarData?.isInCall === true ||
            sidebarData?.inCall === true ||
            sidebarData?.isInMeeting === true ||
            rawState === "connected" ||
            rawState === "started" ||
            rawState === "joined" ||
            rawState === "in_call" ||
            rawState === "incall" ||
            rawState === "in_meeting" ||
            rawState === "meeting";
          if (inCall) {
            meeting = {
              id: "sidebar",
              isActive: true,
            };
          }
        } catch {
          // Sidebar context not available
        }
      }

      updateState({
        isReady: true,
        user: user,
        meeting,
        status: meeting ? "meeting" : "active",
        isInCall: !!meeting,
      });

      // Start listening for events
      await app.listen();

      // Register event handlers
      app.on("meeting:started", handleMeetingEvent);
      app.on("meeting:ended", handleMeetingEvent);
      app.on("meeting:joined", handleMeetingEvent);
      app.on("meeting:left", handleMeetingEvent);
      app.on("call:connected", handleCallEvent);
      app.on("call:disconnected", handleCallEvent);
      app.on("sidebar:callStateChanged", handleSidebarCallStateEvent);
      app.on("presence:changed", handlePresenceEvent);
      
      // Device media events (camera/video state)
      app.on("device:media:active", handleDeviceMediaEvent);
      app.on("device:media:inactive", handleDeviceMediaEvent);
      
      // Device audio events (mic state)
      app.on("device:audio:active", handleDeviceAudioEvent);
      app.on("device:audio:inactive", handleDeviceAudioEvent);
      
      // Space meeting events (for Webex Spaces)
      app.on("space:meeting:started", handleMeetingEvent);
      app.on("space:meeting:ended", handleMeetingEvent);
      app.on("space:meeting:joined", handleMeetingEvent);
      app.on("space:meeting:left", handleMeetingEvent);
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : "Failed to initialize Webex SDK";
      setError(errorMessage);
      updateState({ isInitialized: false });
    }
  }, [
    state.isInitialized,
    updateState,
    handleMeetingEvent,
    handleCallEvent,
    handleSidebarCallStateEvent,
    handlePresenceEvent,
    handleDeviceMediaEvent,
    handleDeviceAudioEvent,
    waitForWebexSDK,
  ]);

  // Cleanup on unmount
  useEffect(() => {
    mountedRef.current = true;

    return () => {
      mountedRef.current = false;
      clearSdkTimeouts();
      if (appRef.current) {
        // Meeting and call events
        appRef.current.off("meeting:started");
        appRef.current.off("meeting:ended");
        appRef.current.off("meeting:joined");
        appRef.current.off("meeting:left");
        appRef.current.off("call:connected");
        appRef.current.off("call:disconnected");
        appRef.current.off("sidebar:callStateChanged");
        appRef.current.off("presence:changed");
        
        // Device media/audio events
        appRef.current.off("device:media:active");
        appRef.current.off("device:media:inactive");
        appRef.current.off("device:audio:active");
        appRef.current.off("device:audio:inactive");
        
        // Space meeting events
        appRef.current.off("space:meeting:started");
        appRef.current.off("space:meeting:ended");
        appRef.current.off("space:meeting:joined");
        appRef.current.off("space:meeting:left");
        
        appRef.current = null;
      }
    };
  }, []);

  return {
    ...state,
    initialize,
    error,
  };
}
