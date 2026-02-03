#include "matrix_display.h"
#include "display_helpers.h"

void MatrixDisplay::showUpdating(const String& version) {
    ota_in_progress = true;  // Lock display for OTA
    showUpdatingProgress(version, 0, "Starting...");
}

void MatrixDisplay::showUpdatingProgress(const String& version, int progress, const String& status) {
    if (!initialized) return;
    ota_in_progress = true;  // Ensure lock is set

    const String screen_key = "updating:" + version;
    StaticScreenBuilder builder(this, screen_key, last_static_key);

    // Progress bar dimensions (constant)
    const int barX = 4;
    const int barY = 17;
    const int barWidth = MATRIX_WIDTH - 8;  // 56 pixels wide
    const int barHeight = 4;

    if (builder.hasChanged()) {
        builder.clearScreen();

        // Title
        builder.drawCentered(0, "UPDATING", COLOR_ORANGE);

        // Progress bar outline (static - only drawn when screen changes)
        drawRect(barX, barY, barWidth, barHeight, COLOR_GRAY);
    }

    // Version - scroll if long (dynamic)
    drawScrollingText(8, "v" + version, COLOR_CYAN, MATRIX_WIDTH - 4, builder.getScrollKey("ver"));

    // Clear previous fill area (dynamic - redraw every frame)
    fillRect(barX + 1, barY + 1, barWidth - 2, barHeight - 2, COLOR_BLACK);
    
    // Fill progress bar (dynamic - redraw every frame)
    if (progress > 0) {
        int fillWidth = ((barWidth - 2) * progress) / 100;
        if (fillWidth > 0) {
            // Color changes from yellow to green as progress increases
            uint16_t fillColor = (progress < 50) ? COLOR_YELLOW :
                                 (progress < 90) ? COLOR_CYAN : COLOR_GREEN;
            fillRect(barX + 1, barY + 1, fillWidth, barHeight - 2, fillColor);
        }
    }

    // Progress percentage (dynamic - redraw every frame)
    String progressText = String(progress) + "%";
    drawCenteredText(24, progressText, COLOR_WHITE);
}
