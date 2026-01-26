#!/usr/bin/env python3
"""
WiFi Scan API Test Script

This script tests the async WiFi scan API to ensure it works correctly
with the new polling pattern.

Usage:
    python test_wifi_scan.py <device_ip>

Example:
    python test_wifi_scan.py 192.168.4.1
"""

import sys
import time
from typing import Dict, List, Optional

import requests


def test_wifi_scan(device_ip: str, timeout: int = 10) -> Optional[List[Dict]]:
    """
    Test the WiFi scan API with polling pattern.

    Args:
        device_ip: IP address of the device (e.g., 192.168.4.1)
        timeout: Maximum time to wait for results in seconds

    Returns:
        List of network dictionaries if successful, None on failure
    """
    api_url = f"http://{device_ip}/api/wifi/scan"
    poll_interval = 0.5  # 500ms
    max_attempts = int(timeout / poll_interval)

    print(f"Testing WiFi scan API at {api_url}")
    print(f"Polling interval: {poll_interval}s, timeout: {timeout}s")
    print("-" * 60)

    try:
        # Initial scan request
        print("1. Starting WiFi scan...")
        response = requests.get(api_url, timeout=5)
        print(f"   Status: {response.status_code}")
        print(f"   Response: {response.json()}")

        # If we got results immediately
        if response.status_code == 200:
            data = response.json()
            if 'networks' in data:
                print(f"✓ Scan completed immediately!")
                return data['networks']

        # If scan started, poll for results
        if response.status_code == 202:
            print("   Scan started, polling for results...")

            for attempt in range(1, max_attempts + 1):
                time.sleep(poll_interval)
                print(f"2. Poll attempt {attempt}/{max_attempts}...", end='')

                poll_response = requests.get(api_url, timeout=5)

                if poll_response.status_code == 200:
                    data = poll_response.json()
                    if 'networks' in data:
                        print(f" ✓ Got results!")
                        return data['networks']
                elif poll_response.status_code == 202:
                    print(" (still scanning)")
                else:
                    print(f" Error: {poll_response.status_code}")
                    return None

            print(f"✗ Timeout after {timeout}s")
            return None

        # Unexpected status code
        print(f"✗ Unexpected status code: {response.status_code}")
        return None

    except requests.exceptions.RequestException as e:
        print(f"✗ Request failed: {e}")
        return None


def display_networks(networks: List[Dict]) -> None:
    """Display network scan results in a formatted table."""
    if not networks:
        print("\nNo networks found")
        return

    print(f"\n{'SSID':<32} {'Signal':<10} {'Encrypted'}")
    print("-" * 60)

    # Sort by signal strength (descending)
    sorted_networks = sorted(networks, key=lambda n: n.get('rssi', -100), reverse=True)

    for network in sorted_networks:
        ssid = network.get('ssid', '(hidden)')
        rssi = network.get('rssi', 'N/A')
        encrypted = '🔒 Yes' if network.get('encrypted') else 'No'

        # Truncate long SSIDs
        if len(ssid) > 30:
            ssid = ssid[:27] + '...'

        print(f"{ssid:<32} {rssi:<10} {encrypted}")

    print(f"\nTotal: {len(networks)} network(s) found")


def main():
    """Main entry point."""
    if len(sys.argv) != 2:
        print("Usage: python test_wifi_scan.py <device_ip>")
        print("Example: python test_wifi_scan.py 192.168.4.1")
        sys.exit(1)

    device_ip = sys.argv[1]

    # Test the scan
    start_time = time.time()
    networks = test_wifi_scan(device_ip, timeout=10)
    elapsed = time.time() - start_time

    print("-" * 60)
    print(f"Test completed in {elapsed:.2f}s")

    if networks is not None:
        display_networks(networks)
        print("\n✓ WiFi scan test PASSED")
        sys.exit(0)
    else:
        print("\n✗ WiFi scan test FAILED")
        sys.exit(1)


if __name__ == '__main__':
    main()
