"use client";

import { useState, useCallback, useRef, useEffect } from "react";

export type SerialStatus =
  | "disconnected"
  | "connecting"
  | "connected"
  | "error";

export interface SerialConfig {
  baudRate?: number;
  dataBits?: 8 | 7;
  stopBits?: 1 | 2;
  parity?: "none" | "even" | "odd";
  flowControl?: "none" | "hardware";
}

export interface UseSerialReturn {
  status: SerialStatus;
  isConnected: boolean;
  isSupported: boolean;
  error: string | null;
  output: string[];
  connect: (config?: SerialConfig) => Promise<boolean>;
  disconnect: () => Promise<void>;
  write: (data: string) => Promise<boolean>;
  writeLine: (data: string) => Promise<boolean>;
  sendCommand: (command: string) => Promise<string | null>;
  clearOutput: () => void;
}

const DEFAULT_BAUD_RATE = 115200;

export function useSerial(): UseSerialReturn {
  const [status, setStatus] = useState<SerialStatus>("disconnected");
  const [error, setError] = useState<string | null>(null);
  const [output, setOutput] = useState<string[]>([]);
  const [isSupported, setIsSupported] = useState(false);

  const portRef = useRef<SerialPort | null>(null);
  const readerRef = useRef<ReadableStreamDefaultReader<Uint8Array> | null>(
    null,
  );
  const writerRef = useRef<WritableStreamDefaultWriter<Uint8Array> | null>(
    null,
  );
  const readLoopRef = useRef<boolean>(false);
  const mountedRef = useRef(true);

  // Check Web Serial API support
  useEffect(() => {
    mountedRef.current = true;
    setIsSupported(typeof navigator !== "undefined" && "serial" in navigator);

    return () => {
      mountedRef.current = false;
    };
  }, []);

  const addOutput = useCallback((line: string) => {
    if (mountedRef.current) {
      setOutput((prev) => [...prev.slice(-99), line]);
    }
  }, []);

  const clearOutput = useCallback(() => {
    setOutput([]);
  }, []);

  const startReadLoop = useCallback(async () => {
    if (!portRef.current?.readable || readLoopRef.current) return;

    readLoopRef.current = true;
    const decoder = new TextDecoder();
    let buffer = "";

    try {
      readerRef.current = portRef.current.readable.getReader();

      while (readLoopRef.current && mountedRef.current) {
        const { value, done } = await readerRef.current.read();

        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        // Process complete lines
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed) {
            addOutput(trimmed);
          }
        }
      }
    } catch (err) {
      if (mountedRef.current && readLoopRef.current) {
        console.error("Serial read error:", err);
        setError("Serial read error");
        setStatus("error");
      }
    } finally {
      readLoopRef.current = false;
      readerRef.current?.releaseLock();
      readerRef.current = null;
    }
  }, [addOutput]);

  const connect = useCallback(
    async (config: SerialConfig = {}): Promise<boolean> => {
      if (!isSupported) {
        setError("Web Serial API not supported");
        return false;
      }

      try {
        setStatus("connecting");
        setError(null);

        // Request port from user
        const port = await navigator.serial.requestPort();

        // Open the port with merged config
        await port.open({
          baudRate: config.baudRate ?? DEFAULT_BAUD_RATE,
          dataBits: config.dataBits ?? 8,
          stopBits: config.stopBits ?? 1,
          parity: config.parity ?? "none",
          flowControl: config.flowControl ?? "none",
        });

        portRef.current = port;

        // Get writer
        if (port.writable) {
          writerRef.current = port.writable.getWriter();
        }

        setStatus("connected");
        addOutput("Connected to serial port");

        // Start reading
        startReadLoop();

        return true;
      } catch (err) {
        const errorMessage =
          err instanceof Error ? err.message : "Failed to connect";
        console.error("Serial connect error:", err);
        setError(errorMessage);
        setStatus("error");
        return false;
      }
    },
    [isSupported, addOutput, startReadLoop],
  );

  const disconnect = useCallback(async () => {
    readLoopRef.current = false;

    try {
      if (readerRef.current) {
        await readerRef.current.cancel();
        readerRef.current.releaseLock();
        readerRef.current = null;
      }

      if (writerRef.current) {
        writerRef.current.releaseLock();
        writerRef.current = null;
      }

      if (portRef.current) {
        await portRef.current.close();
        portRef.current = null;
      }

      addOutput("Disconnected from serial port");
    } catch (err) {
      console.error("Serial disconnect error:", err);
    }

    setStatus("disconnected");
    setError(null);
  }, [addOutput]);

  const write = useCallback(async (data: string): Promise<boolean> => {
    if (!writerRef.current) {
      setError("Serial port not connected");
      return false;
    }

    try {
      const encoder = new TextEncoder();
      await writerRef.current.write(encoder.encode(data));
      return true;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "Write failed";
      console.error("Serial write error:", err);
      setError(errorMessage);
      return false;
    }
  }, []);

  const writeLine = useCallback(
    async (data: string): Promise<boolean> => {
      return write(data + "\r\n");
    },
    [write],
  );

  const sendCommand = useCallback(
    async (command: string): Promise<string | null> => {
      if (!(await writeLine(command))) {
        return null;
      }

      // Wait a bit for response
      await new Promise((resolve) => setTimeout(resolve, 500));

      // Return the last line of output (simple implementation)
      return output[output.length - 1] || null;
    },
    [writeLine, output],
  );

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      mountedRef.current = false;
      readLoopRef.current = false;

      // Cleanup without await in cleanup function
      if (readerRef.current) {
        readerRef.current.cancel().catch(() => {});
      }
      if (portRef.current) {
        portRef.current.close().catch(() => {});
      }
    };
  }, []);

  return {
    status,
    isConnected: status === "connected",
    isSupported,
    error,
    output,
    connect,
    disconnect,
    write,
    writeLine,
    sendCommand,
    clearOutput,
  };
}
