#include "matrix_display.h"

void MatrixDisplay::showWaitingForWebex(const String& hostname) {
    if (!initialized) return;

    const String screen_key = "waiting:" + hostname;
    const bool screen_changed = (last_static_key != screen_key);

    if (screen_changed) {
        last_static_key = screen_key;
        dma_display->clearScreen();

        // Status indicator
        drawStatusIcon(MATRIX_WIDTH / 2 - 4, 0, "pending");

        // Message
        drawCenteredText(getTextLineY(1, 8, 2), "WAITING", COLOR_YELLOW);

        // Separator
        dma_display->drawFastHLine(0, 17, MATRIX_WIDTH, COLOR_GRAY);

        // Label
        drawCenteredText(getTextLineY(2, 8, 2), "Connect via:", COLOR_WHITE);
    }
    
    // Hostname scrolls if long
    String displayHost = hostname + ".local";
    drawScrollingText(getTextLineY(3, 8, 2), displayHost, COLOR_CYAN, MATRIX_WIDTH - 4, "wait_host");
}
