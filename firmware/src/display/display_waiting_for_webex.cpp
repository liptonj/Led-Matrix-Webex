#include "matrix_display.h"

void MatrixDisplay::showWaitingForWebex(const String& hostname) {
    if (!initialized) return;

    dma_display->clearScreen();

    // Status indicator - pulsing effect would be nice but static for now
    drawStatusIcon(MATRIX_WIDTH / 2 - 4, 0, "pending");

    // Message
    drawCenteredText(getTextLineY(1, 8, 2), "WAITING", COLOR_YELLOW);

    // Separator
    dma_display->drawFastHLine(0, 17, MATRIX_WIDTH, COLOR_GRAY);

    // Hostname info
    drawCenteredText(getTextLineY(2, 8, 2), "Connect via:", COLOR_WHITE);

    String displayHost = hostname;
    if (displayHost.length() > 10) {
        displayHost = hostname.substring(0, 10);
    }
    drawCenteredText(getTextLineY(3, 8, 2), displayHost, COLOR_CYAN);
}
