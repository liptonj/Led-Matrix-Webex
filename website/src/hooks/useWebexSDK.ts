"use client";

import { useState, useEffect, useCallback, useRef } from "react";

export type WebexStatus =
  | "active"
  | "meeting"
  | "call"
  | "presenting"
  | "dnd"
  | "away"
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
interface WebexApp {
  onReady: () => Promise<void>;
  context: {
    getUser: () => Promise<{ id: string; displayName: string; email?: string }>;
    getMeeting?: () => Promise<{ id: string; title?: string } | null>;
  };
  listen: () => Promise<void>;
  on: (event: string, callback: (data: unknown) => void) => void;
  off: (event: string, callback?: (data: unknown) => void) => void;
}

declare global {
  interface Window {
    Webex?: {
      Application: {
        new (): WebexApp;
      };
    };
  }
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

  const handlePresenceEvent = useCallback(
    (data: unknown) => {
      const presenceData = data as { status?: string };
      const statusMap: Record<string, WebexStatus> = {
        active: "active",
        available: "active",
        meeting: "meeting",
        call: "call",
        presenting: "presenting",
        dnd: "dnd",
        donotdisturb: "dnd",
        away: "away",
        inactive: "away",
        offline: "offline",
      };

      const newStatus =
        statusMap[presenceData.status?.toLowerCase() || ""] || "unknown";
      updateState({ status: newStatus });
    },
    [updateState],
  );

  const initialize = useCallback(async () => {
    if (state.isInitialized || appRef.current) {
      return;
    }

    // Check if SDK is available
    if (typeof window === "undefined" || !window.Webex?.Application) {
      setError(
        "Webex SDK not available. Make sure you are running inside a Webex embedded app.",
      );
      return;
    }

    try {
      updateState({ isInitialized: true });

      // Create Webex Application instance
      const app = new window.Webex.Application();
      appRef.current = app;

      // Wait for app to be ready
      await app.onReady();

      if (!mountedRef.current) return;

      // Get user info
      const user = await app.context.getUser();

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

      updateState({
        isReady: true,
        user: {
          id: user.id,
          displayName: user.displayName,
          email: user.email,
        },
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
      app.on("presence:changed", handlePresenceEvent);
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : "Failed to initialize Webex SDK";
      console.error("Webex SDK initialization error:", err);
      setError(errorMessage);
      updateState({ isInitialized: false });
    }
  }, [
    state.isInitialized,
    updateState,
    handleMeetingEvent,
    handleCallEvent,
    handlePresenceEvent,
  ]);

  // Cleanup on unmount
  useEffect(() => {
    mountedRef.current = true;

    return () => {
      mountedRef.current = false;
      if (appRef.current) {
        appRef.current.off("meeting:started");
        appRef.current.off("meeting:ended");
        appRef.current.off("meeting:joined");
        appRef.current.off("meeting:left");
        appRef.current.off("call:connected");
        appRef.current.off("call:disconnected");
        appRef.current.off("presence:changed");
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
