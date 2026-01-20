#include "matrix_display.h"

void MatrixDisplay::showSetupHostname(const String& hostname) {
    if (!initialized) return;

    dma_display->clearScreen();

    // Title
    drawCenteredText(getTextLineY(0, 9), "SETUP", COLOR_CYAN);

    // Separator
    dma_display->drawFastHLine(0, 8, MATRIX_WIDTH, COLOR_GRAY);

    // Instructions
    drawCenteredText(getTextLineY(1, 9), "Open in Webex:", COLOR_WHITE);

    // Hostname - may need to scroll if too long
    String displayHost = hostname;
    if (displayHost.length() > 10) {
        // Truncate with ".local" visible
        displayHost = hostname.substring(0, 7) + "...";
    }
    drawCenteredText(getTextLineY(2, 9), displayHost, COLOR_GREEN);

    // Separator
    dma_display->drawFastHLine(0, 25, MATRIX_WIDTH, COLOR_GRAY);

    // Embedded app path hint
    drawCenteredText(getTextLineY(3, 9), "/embedded", COLOR_YELLOW);
}
