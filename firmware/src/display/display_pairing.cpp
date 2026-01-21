/**
 * @file display_pairing.cpp
 * @brief Display pairing code for bridge connection
 */

#include "matrix_display.h"

/**
 * @brief Show pairing code for bridge connection
 * 
 * Display layout (64x32):
 * Row 0-7:   "PAIR CODE"
 * Row 10-22: Large pairing code (e.g., "ABC123")
 * Row 24-31: "Bridge ready" or bridge URL
 */
void MatrixDisplay::showPairingCode(const String& code, const String& bridge_url) {
    if (!dma_display) return;
    
    dma_display->fillScreen(COLOR_BLACK);
    
    // Title: "PAIR CODE" at top (centered)
    drawCenteredText(0, "PAIR CODE", COLOR_CYAN);
    
    // Draw separator line
    dma_display->drawFastHLine(4, 8, MATRIX_WIDTH - 8, COLOR_GRAY);
    
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
    
    // Bottom text
    if (bridge_url.isEmpty()) {
        // Show "Bridge ready"
        drawCenteredText(24, "Bridge ready", COLOR_GREEN);
    } else {
        // Show abbreviated bridge URL
        String shortUrl = bridge_url;
        // Remove ws:// or wss:// prefix
        if (shortUrl.startsWith("ws://")) {
            shortUrl = shortUrl.substring(5);
        } else if (shortUrl.startsWith("wss://")) {
            shortUrl = shortUrl.substring(6);
        }
        // Truncate if too long
        if (shortUrl.length() > 10) {
            shortUrl = shortUrl.substring(0, 8) + "..";
        }
        
        drawCenteredText(24, shortUrl, COLOR_CYAN);
    }
}
