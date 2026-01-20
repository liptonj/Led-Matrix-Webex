#include "matrix_display.h"

void MatrixDisplay::showUpdating(const String& version) {
    if (!initialized) return;

    dma_display->clearScreen();
    drawText(4, getTextLineY(0, 10, 4), "UPDATING", COLOR_ORANGE);
    drawSmallText(2, getTextLineY(1, 10, 4), "Installing:", COLOR_WHITE);
    drawSmallText(2, getTextLineY(2, 10, 4), version, COLOR_CYAN);
}
