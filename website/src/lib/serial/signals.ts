/**
 * Serial signal utilities for ESP32 hardware control.
 * 
 * These functions use the Web Serial API's setSignals() method to toggle
 * DTR (Data Terminal Ready) and RTS (Request To Send) lines, which on
 * ESP32 development boards are wired to the EN (reset) and IO0 (boot mode) pins.
 * 
 * Signal mapping (typical ESP32 dev board):
 *   RTS -> EN (chip enable / reset, active LOW)
 *   DTR -> IO0 (boot mode select, LOW = download mode)
 */

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Perform a hardware reset on the ESP32 device.
 * 
 * Toggles the RTS line (connected to EN/reset pin) to trigger a chip reset.
 * The device will restart and execute the firmware from the beginning.
 * 
 * Sequence:
 *   1. RTS LOW (EN LOW) -- hold device in reset
 *   2. Wait 100ms for signal to stabilize
 *   3. RTS HIGH (EN HIGH) -- release reset, device boots
 * 
 * @param port - An open Web Serial API SerialPort instance
 * @throws Error if setSignals fails (port not open, USB disconnected, etc.)
 */
export async function resetDevice(port: SerialPort): Promise<void> {
  try {
    await port.setSignals({ dataTerminalReady: false, requestToSend: true });
    await sleep(100);
    await port.setSignals({ dataTerminalReady: false, requestToSend: false });
  } catch (error) {
    throw new Error(
      `Failed to reset device: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }
}

/**
 * Enter bootloader (download) mode on the ESP32 device.
 * 
 * Uses the DTR/RTS sequence to hold IO0 LOW during reset, which causes
 * the ESP32 to enter its serial bootloader instead of running firmware.
 * This is required before flashing firmware via esptool-js.
 * 
 * Sequence:
 *   1. RTS LOW (EN LOW) -- hold device in reset
 *   2. Wait 100ms for signal to stabilize
 *   3. DTR HIGH (IO0 LOW) + RTS HIGH (EN HIGH) -- boot with IO0 held LOW
 *   4. Wait 50ms for boot mode to latch
 *   5. DTR LOW (IO0 HIGH) + RTS LOW -- release all signals
 * 
 * After this sequence, the ESP32's ROM bootloader is active and ready
 * to receive commands from esptool-js.
 * 
 * @param port - An open Web Serial API SerialPort instance
 * @throws Error if setSignals fails (port not open, USB disconnected, etc.)
 */
export async function enterBootloader(port: SerialPort): Promise<void> {
  try {
    await port.setSignals({ dataTerminalReady: false, requestToSend: true });
    await sleep(100);
    await port.setSignals({ dataTerminalReady: true, requestToSend: false });
    await sleep(50);
    await port.setSignals({ dataTerminalReady: false, requestToSend: false });
  } catch (error) {
    throw new Error(
      `Failed to enter bootloader: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }
}
