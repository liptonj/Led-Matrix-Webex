"use client";

import { useState, useEffect, useCallback, useRef } from "react";

export type WebSocketStatus =
  | "disconnected"
  | "connecting"
  | "connected"
  | "error";

export interface WebSocketMessage {
  type: string;
  [key: string]: unknown;
}

export interface CommandResponse {
  requestId: string;
  success: boolean;
  data?: Record<string, unknown>;
  error?: string;
}

export interface UseWebSocketOptions {
  url: string;
  reconnect?: boolean;
  reconnectInterval?: number;
  maxReconnectAttempts?: number;
  onOpen?: () => void;
  onClose?: () => void;
  onError?: (error: Event) => void;
  onMessage?: (message: WebSocketMessage) => void;
}

export interface UseWebSocketReturn {
  status: WebSocketStatus;
  isConnected: boolean;
  lastMessage: WebSocketMessage | null;
  connect: () => void;
  disconnect: () => void;
  send: (message: WebSocketMessage) => boolean;
  sendCommand: (command: string, payload?: Record<string, unknown>) => Promise<CommandResponse>;
  reconnectAttempts: number;
}

// Generate unique request ID
function generateRequestId(): string {
  return `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

export function useWebSocket(options: UseWebSocketOptions): UseWebSocketReturn {
  const {
    url,
    reconnect = true,
    reconnectInterval = 3000,
    maxReconnectAttempts = 10,
    onOpen,
    onClose,
    onError,
    onMessage,
  } = options;

  const [status, setStatus] = useState<WebSocketStatus>("disconnected");
  const [lastMessage, setLastMessage] = useState<WebSocketMessage | null>(null);
  const [reconnectAttempts, setReconnectAttempts] = useState(0);

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const mountedRef = useRef(true);
  const pendingCommandsRef = useRef<Map<string, {
    resolve: (response: CommandResponse) => void;
    reject: (error: Error) => void;
    timeout: NodeJS.Timeout;
  }>>(new Map());

  const clearReconnectTimeout = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
  }, []);

  const disconnect = useCallback(() => {
    clearReconnectTimeout();
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    setStatus("disconnected");
  }, [clearReconnectTimeout]);

  const connect = useCallback(() => {
    if (!mountedRef.current) return;
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    // Close existing connection if any
    if (wsRef.current) {
      wsRef.current.close();
    }

    setStatus("connecting");

    try {
      const ws = new WebSocket(url);
      wsRef.current = ws;

      ws.onopen = () => {
        if (!mountedRef.current) return;
        setStatus("connected");
        setReconnectAttempts(0);
        onOpen?.();
      };

      ws.onclose = () => {
        if (!mountedRef.current) return;
        setStatus("disconnected");
        wsRef.current = null;
        onClose?.();

        // Auto-reconnect
        if (reconnect && reconnectAttempts < maxReconnectAttempts) {
          reconnectTimeoutRef.current = setTimeout(() => {
            if (mountedRef.current) {
              setReconnectAttempts((prev) => prev + 1);
              connect();
            }
          }, reconnectInterval);
        }
      };

      ws.onerror = (event) => {
        if (!mountedRef.current) return;
        setStatus("error");
        onError?.(event);
      };

      ws.onmessage = (event) => {
        if (!mountedRef.current) return;
        try {
          const message = JSON.parse(event.data) as WebSocketMessage;
          
          // Handle command responses
          if (message.type === "command_response" && message.requestId) {
            const requestId = message.requestId as string;
            const pending = pendingCommandsRef.current.get(requestId);
            if (pending) {
              clearTimeout(pending.timeout);
              pendingCommandsRef.current.delete(requestId);
              pending.resolve({
                requestId,
                success: message.success as boolean,
                data: message.data as Record<string, unknown> | undefined,
                error: message.error as string | undefined,
              });
            }
          }
          
          setLastMessage(message);
          onMessage?.(message);
        } catch {
          console.error("Failed to parse WebSocket message:", event.data);
        }
      };
    } catch (error) {
      console.error("Failed to create WebSocket:", error);
      setStatus("error");
    }
  }, [
    url,
    reconnect,
    reconnectInterval,
    maxReconnectAttempts,
    reconnectAttempts,
    onOpen,
    onClose,
    onError,
    onMessage,
  ]);

  const send = useCallback((message: WebSocketMessage): boolean => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(message));
      return true;
    }
    return false;
  }, []);

  const sendCommand = useCallback(
    (command: string, payload?: Record<string, unknown>): Promise<CommandResponse> => {
      return new Promise((resolve, reject) => {
        if (wsRef.current?.readyState !== WebSocket.OPEN) {
          reject(new Error("WebSocket not connected"));
          return;
        }

        const requestId = generateRequestId();
        const timeoutMs = 10000; // 10 second timeout for commands

        const timeout = setTimeout(() => {
          pendingCommandsRef.current.delete(requestId);
          reject(new Error(`Command "${command}" timed out`));
        }, timeoutMs);

        pendingCommandsRef.current.set(requestId, { resolve, reject, timeout });

        const message: WebSocketMessage = {
          type: "command",
          command,
          requestId,
          payload: payload || {},
        };

        wsRef.current.send(JSON.stringify(message));
      });
    },
    []
  );

  // Cleanup on unmount
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      clearReconnectTimeout();
      
      // Clear all pending commands
      for (const [, pending] of pendingCommandsRef.current) {
        clearTimeout(pending.timeout);
        pending.reject(new Error("Component unmounted"));
      }
      pendingCommandsRef.current.clear();
      
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [clearReconnectTimeout]);

  return {
    status,
    isConnected: status === "connected",
    lastMessage,
    connect,
    disconnect,
    send,
    sendCommand,
    reconnectAttempts,
  };
}
