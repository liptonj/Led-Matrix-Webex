#include "matrix_display.h"

void MatrixDisplay::showSetupHostname(const String& hostname) {
    if (!initialized) return;

    const String screen_key = "setup:" + hostname;
    const bool screen_changed = (last_static_key != screen_key);

    if (screen_changed) {
        last_static_key = screen_key;
        dma_display->clearScreen();

        // Title
        drawCenteredText(getTextLineY(0, 9), "SETUP", COLOR_CYAN);

        // Separator
        dma_display->drawFastHLine(0, 8, MATRIX_WIDTH, COLOR_GRAY);

        // Instructions
        drawCenteredText(getTextLineY(1, 9), "Open in Webex:", COLOR_WHITE);

        // Separator
        dma_display->drawFastHLine(0, 25, MATRIX_WIDTH, COLOR_GRAY);

        // Embedded app path hint
        drawCenteredText(getTextLineY(3, 9), "/embedded", COLOR_YELLOW);
    }
    
    // Hostname scrolls if long
    String displayHost = hostname + ".local";
    drawScrollingText(getTextLineY(2, 9), displayHost, COLOR_GREEN, MATRIX_WIDTH - 4, "setup_host");
}
