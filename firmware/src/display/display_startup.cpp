#include "matrix_display.h"

void MatrixDisplay::showStartupScreen(const char* version) {
    if (!initialized) return;

    dma_display->clearScreen();
    drawText(8, getTextLineY(0, 10, 4), "WEBEX", COLOR_CYAN);
    drawText(4, getTextLineY(1, 10, 4), "DISPLAY", COLOR_WHITE);

    char ver_str[16];
    snprintf(ver_str, sizeof(ver_str), "v%s", version);
    drawSmallText(16, getTextLineY(2, 10, 4), ver_str, COLOR_GRAY);
}
