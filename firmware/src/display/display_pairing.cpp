/**
 * @file display_pairing.cpp
 * @brief Display pairing code for app connection
 */

#include "matrix_display.h"
#include "display_helpers.h"

/**
 * @brief Show pairing code for app connection
 * 
 * Display layout (64x32):
 * Row 0-7:   "PAIR CODE"
 * Row 10-22: Large pairing code (e.g., "ABC123")
 * Row 24-31: "Pairing ready" or hub URL (scrolls if long)
 */
void MatrixDisplay::showPairingCode(const String& code, const String& hub_url) {
    if (!initialized) return;
    
    const String screen_key = "pairing:" + code + "|" + hub_url;
    StaticScreenBuilder builder(this, screen_key, last_static_key);
    
    if (builder.hasChanged()) {
        builder.clearScreen();
        
        // Title: "PAIR CODE" at top (centered)
        builder.drawCentered(0, "PAIR CODE", COLOR_CYAN);
        
        // Draw separator line
        builder.drawSeparator(8, COLOR_GRAY);
        
        // Pairing code in center
        String displayCode = code;
        displayCode.toUpperCase();
        
        // Calculate code display width (6 pixels per char)
        int charWidth = 7;  // Width per character with spacing
        int codeWidth = displayCode.length() * charWidth;
        int codeStartX = (MATRIX_WIDTH - codeWidth) / 2;
        
        // Draw each character with spacing and boxes
        dma_display->setTextColor(COLOR_WHITE);
        dma_display->setTextSize(1);
        
        for (size_t i = 0; i < displayCode.length(); i++) {
            int charX = codeStartX + (i * charWidth) + 1;
            // Draw box around character
            dma_display->drawRect(codeStartX + (i * charWidth), 10, charWidth - 1, 10, COLOR_GRAY);
            // Draw character
            dma_display->setCursor(charX, 12);
            dma_display->print(displayCode.charAt(i));
        }
    }
    
    // Bottom text - scrolls if URL is long
    if (hub_url.isEmpty()) {
        drawScrollingText(24, "Pairing ready", COLOR_GREEN, MATRIX_WIDTH - 4, builder.getScrollKey("status"));
    } else {
        // Show hub URL (remove ws:// prefix for display)
        String shortUrl = hub_url;
        if (shortUrl.startsWith("ws://")) {
            shortUrl = shortUrl.substring(5);
        } else if (shortUrl.startsWith("wss://")) {
            shortUrl = shortUrl.substring(6);
        }
        drawScrollingText(24, shortUrl, COLOR_CYAN, MATRIX_WIDTH - 4, builder.getScrollKey("url"));
    }
}

/**
 * @brief Display provisioning status with serial number
 * 
 * Display layout (64x32):
 * Row 0-7:   "SETUP" (orange)
 * Row 9-15:  "Visit website" / "Approve device:" (small text)
 * Row 16-24: Serial number in large green text
 * 
 * Also prints serial number to Serial monitor.
 * 
 * @param serial_number Device serial number to display
 */
void MatrixDisplay::displayProvisioningStatus(const String& serial_number) {
    if (!initialized) return;
    
    const String screen_key = "provisioning:" + serial_number;
    StaticScreenBuilder builder(this, screen_key, last_static_key);
    
    if (builder.hasChanged()) {
        builder.clearScreen();
        
        // Title: "SETUP" at top (centered, orange)
        builder.drawCentered(0, "SETUP", COLOR_ORANGE);
        
        // Draw separator line
        builder.drawSeparator(8, COLOR_GRAY);
        
        // Instructions text
        drawSmallText(2, 10, "Visit website", COLOR_WHITE);
        drawSmallText(2, 18, "Approve device:", COLOR_WHITE);
        
        // Serial number in large green text (similar to pairing code style)
        String displaySerial = serial_number;
        displaySerial.toUpperCase();
        
        // Calculate serial display width (6 pixels per char for size 1)
        int charWidth = 6;  // Width per character
        int serialWidth = displaySerial.length() * charWidth;
        int serialStartX = (MATRIX_WIDTH - serialWidth) / 2;
        
        // Draw serial number in green
        dma_display->setTextColor(COLOR_GREEN);
        dma_display->setTextSize(1);
        dma_display->setCursor(serialStartX, 26);
        dma_display->print(displaySerial);
        
        // Print to Serial monitor (only when screen changes)
        Serial.println("[DISPLAY] Device awaiting approval");
        Serial.printf("[DISPLAY] Serial: %s\n", serial_number.c_str());
    }
}
