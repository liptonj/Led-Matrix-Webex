"use client";

import { useState, useCallback } from "react";
import { useSerial } from "@/hooks/useSerial";

export function useWiFiScan() {
  const [availableNetworks, setAvailableNetworks] = useState<string[]>([]);
  const [isScanning, setIsScanning] = useState(false);
  const [wifiStatus, setWifiStatus] = useState<{
    message: string;
    type: "info" | "success" | "error";
  } | null>(null);

  const {
    isSupported,
    isConnected,
    error: serialError,
    output: serialOutput,
    connect,
    writeLine,
  } = useSerial();

  const parseNetworksFromOutput = useCallback((output: string[]): string[] => {
    const networks: string[] = [];
    const seenNetworks = new Set<string>();

    for (const line of output) {
      const ssidMatch = line.match(/(?:SSID|WIFI_SCAN):\s*(.+?)(?:\s|$)/i);
      if (ssidMatch && ssidMatch[1]) {
        const network = ssidMatch[1].trim();
        if (network && !seenNetworks.has(network)) {
          seenNetworks.add(network);
          networks.push(network);
        }
      }
    }

    return networks;
  }, []);

  const scanNetworks = useCallback(async () => {
    if (!isSupported || isScanning) return;

    setIsScanning(true);
    setWifiStatus({ message: "Scanning for WiFi networks...", type: "info" });

    const connected = isConnected || (await connect());
    if (!connected) {
      setWifiStatus({
        message: "Could not connect to device. Enter WiFi manually.",
        type: "info",
      });
      setIsScanning(false);
      return;
    }

    const sent = await writeLine("SCAN_WIFI");
    if (!sent) {
      setWifiStatus({
        message: "Scan failed. Enter WiFi manually.",
        type: "info",
      });
      setIsScanning(false);
      return;
    }

    setTimeout(() => {
      const networks = parseNetworksFromOutput(serialOutput);
      if (networks.length > 0) {
        setAvailableNetworks(networks);
        setWifiStatus({
          message: `Found ${networks.length} network(s)`,
          type: "success",
        });
      } else {
        setWifiStatus(null);
      }
      setIsScanning(false);
    }, 5000);
  }, [
    isSupported,
    isScanning,
    isConnected,
    connect,
    writeLine,
    serialOutput,
    parseNetworksFromOutput,
  ]);

  const sendWiFiConfig = useCallback(
    async (ssid: string, password: string): Promise<boolean> => {
      if (!isSupported) {
        setWifiStatus({
          message: "Serial not supported in this browser",
          type: "error",
        });
        return false;
      }

      const connected = isConnected || (await connect());
      if (!connected) {
        setWifiStatus({
          message: "Failed to connect to device",
          type: "error",
        });
        return false;
      }

      // Send WiFi credentials
      const wifiCommand = `WIFI:${ssid}:${password}`;
      const sent = await writeLine(wifiCommand);

      if (!sent) {
        setWifiStatus({
          message: "Failed to send WiFi configuration",
          type: "error",
        });
        return false;
      }

      setWifiStatus({
        message: "WiFi configured successfully!",
        type: "success",
      });
      return true;
    },
    [isSupported, isConnected, connect, writeLine],
  );

  return {
    availableNetworks,
    isScanning,
    wifiStatus,
    setWifiStatus,
    scanNetworks,
    sendWiFiConfig,
    isSerialSupported: isSupported,
    serialError,
  };
}
