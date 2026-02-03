/**
 * @file display_icons.cpp
 * @brief Icon Drawing Functions
 * 
 * Contains functions for drawing icons and status indicators on the display.
 */

#include "matrix_display.h"
#include "icons.h"

void MatrixDisplay::drawStatusIndicator(int x, int y, const String& status) {
    uint16_t color = getStatusColor(status);
    
    static const uint8_t INDICATOR_ICON[36] = {
        0,1,1,1,1,0,
        1,1,1,1,1,1,
        1,1,1,1,1,1,
        1,1,1,1,1,1,
        1,1,1,1,1,1,
        0,1,1,1,1,0
    };
    
    for (int dy = 0; dy < 6; dy++) {
        for (int dx = 0; dx < 6; dx++) {
            if (INDICATOR_ICON[dy * 6 + dx]) {
                int px = x + dx;
                int py = y + dy;
                if (px >= 0 && px < MATRIX_WIDTH && py >= 0 && py < MATRIX_HEIGHT) {
                    dma_display->drawPixel(px, py, color);
                }
            }
        }
    }
}

void MatrixDisplay::drawSmallStatusIndicator(int x, int y, const String& status) {
    uint16_t color = getStatusColor(status);
    
    // 4x4 filled circle indicator
    static const uint8_t SMALL_INDICATOR[16] = {
        0,1,1,0,
        1,1,1,1,
        1,1,1,1,
        0,1,1,0
    };
    
    for (int dy = 0; dy < 4; dy++) {
        for (int dx = 0; dx < 4; dx++) {
            if (SMALL_INDICATOR[dy * 4 + dx]) {
                int px = x + dx;
                int py = y + dy;
                if (px >= 0 && px < MATRIX_WIDTH && py >= 0 && py < MATRIX_HEIGHT) {
                    dma_display->drawPixel(px, py, color);
                }
            }
        }
    }
}

void MatrixDisplay::drawLargeStatusCircle(int center_x, int center_y, uint16_t color) {
    int start_x = center_x - 6;
    int start_y = center_y - 6;

    for (int dy = 0; dy < 12; dy++) {
        for (int dx = 0; dx < 12; dx++) {
            if (STATUS_ICON_LARGE[dy * 12 + dx]) {
                int px = start_x + dx;
                int py = start_y + dy;
                if (px >= 0 && px < MATRIX_WIDTH && py >= 0 && py < MATRIX_HEIGHT) {
                    dma_display->drawPixel(px, py, color);
                }
            }
        }
    }
}

/**
 * @brief Draw a 1-bit bitmap at the specified position with bounds checking
 * 
 * This is the core icon drawing function that all specific icon functions use.
 * 
 * @param x X position (top-left corner)
 * @param y Y position (top-left corner)
 * @param bitmap Pointer to bitmap data (1 = pixel on, 0 = pixel off)
 * @param width Width of the bitmap in pixels
 * @param height Height of the bitmap in pixels
 * @param color Color for lit pixels
 */
void MatrixDisplay::drawBitmap(int x, int y, const uint8_t* bitmap, int width, int height, uint16_t color) {
    for (int dy = 0; dy < height; dy++) {
        for (int dx = 0; dx < width; dx++) {
            if (bitmap[dy * width + dx]) {
                int px = x + dx;
                int py = y + dy;
                if (px >= 0 && px < MATRIX_WIDTH && py >= 0 && py < MATRIX_HEIGHT) {
                    dma_display->drawPixel(px, py, color);
                }
            }
        }
    }
}

/**
 * @brief Draw a strikethrough X over an icon area
 * 
 * Used to indicate "off" or "muted" state by drawing an X over the icon.
 * 
 * @param x X position (top-left corner)
 * @param y Y position (top-left corner)
 * @param width Width of the icon
 * @param height Height of the icon
 * @param color Color for the strikethrough lines
 */
void MatrixDisplay::drawIconStrikethrough(int x, int y, int width, int height, uint16_t color) {
    int x1 = x;
    int y1 = y;
    int x2 = x + width - 1;
    int y2 = y + height - 1;
    
    // Bounds check
    if (x1 >= 0 && x1 < MATRIX_WIDTH && y1 >= 0 && y1 < MATRIX_HEIGHT &&
        x2 >= 0 && x2 < MATRIX_WIDTH && y2 >= 0 && y2 < MATRIX_HEIGHT) {
        dma_display->drawLine(x1, y1, x2, y2, color);
        dma_display->drawLine(x1, y2, x2, y1, color);
    }
}

void MatrixDisplay::drawStatusIcon(int x, int y, const String& status) {
    drawBitmap(x, y, STATUS_ICON, 8, 8, getStatusColor(status));
}

void MatrixDisplay::drawCameraIcon(int x, int y, bool on) {
    uint16_t color = on ? COLOR_GREEN : COLOR_RED;
    drawBitmap(x, y, CAMERA_ICON, 8, 5, color);
    
    if (!on) {
        drawIconStrikethrough(x, y, 8, 5, COLOR_RED);
    }
}

void MatrixDisplay::drawMicIcon(int x, int y, bool muted) {
    uint16_t color = muted ? COLOR_RED : COLOR_GREEN;
    drawBitmap(x, y, MIC_ICON, 5, 5, color);
    
    if (muted) {
        drawIconStrikethrough(x, y, 5, 5, COLOR_RED);
    }
}

void MatrixDisplay::drawCallIcon(int x, int y) {
    drawBitmap(x, y, CALL_ICON, 8, 5, COLOR_GREEN);
}

void MatrixDisplay::drawWifiIcon(int x, int y, bool connected) {
    uint16_t color = connected ? COLOR_GREEN : COLOR_RED;
    drawBitmap(x, y, WIFI_ICON, 7, 5, color);
}
