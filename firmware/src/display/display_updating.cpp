#include "matrix_display.h"

void MatrixDisplay::showUpdating(const String& version) {
    ota_in_progress = true;  // Lock display for OTA
    showUpdatingProgress(version, 0, "Starting...");
}

void MatrixDisplay::showUpdatingProgress(const String& version, int progress, const String& status) {
    if (!initialized) return;
    ota_in_progress = true;  // Ensure lock is set

    dma_display->clearScreen();
    
    // Title
    drawCenteredText(0, "UPDATING", COLOR_ORANGE);
    
    // Version
    drawCenteredText(8, version, COLOR_CYAN);
    
    // Progress bar (at y=17, 4 pixels high)
    int barX = 4;
    int barY = 17;
    int barWidth = MATRIX_WIDTH - 8;  // 56 pixels wide
    int barHeight = 4;
    
    // Draw progress bar outline
    dma_display->drawRect(barX, barY, barWidth, barHeight, COLOR_GRAY);
    
    // Fill progress bar
    if (progress > 0) {
        int fillWidth = ((barWidth - 2) * progress) / 100;
        if (fillWidth > 0) {
            // Color changes from yellow to green as progress increases
            uint16_t fillColor = (progress < 50) ? COLOR_YELLOW : 
                                 (progress < 90) ? COLOR_CYAN : COLOR_GREEN;
            dma_display->fillRect(barX + 1, barY + 1, fillWidth, barHeight - 2, fillColor);
        }
    }
    
    // Progress percentage
    String progressText = String(progress) + "%";
    drawCenteredText(24, progressText, COLOR_WHITE);
}
