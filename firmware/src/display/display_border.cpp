/**
 * @file display_border.cpp
 * @brief Border Drawing and Cache Management
 *
 * Handles border width clamping, border drawing with caching,
 * and border cache state management.
 */

#include "matrix_display.h"
#include "../debug/log_system.h"

static const char* TAG = "DISP_BORDER";

// Border cache state
static String last_border_key;
static StatusLayoutMode last_status_layout = StatusLayoutMode::SENSORS;

/**
 * @brief Clamp border width to valid range (1-3 pixels)
 */
int MatrixDisplay::clampBorderWidth(int width) {
    if (width < 1) return 1;
    if (width > 3) return 3;
    return width;
}

/**
 * @brief Update border cache and redraw border if needed
 * 
 * @param status_color Color for the border
 * @param border Border width (already clamped)
 * @param status Status string for cache key
 * @param layout Current layout mode for cache invalidation
 * @return true if border was redrawn, false if cached
 */
bool MatrixDisplay::updateBorderCache(uint16_t status_color, int border, 
                                       const String& status, StatusLayoutMode layout) {
    // Build cache key
    char border_key_buf[64];
    snprintf(border_key_buf, sizeof(border_key_buf), "border|%s|%d", status.c_str(), border);
    const String border_key = String(border_key_buf);
    
    bool border_changed = (border_key != last_border_key);
    bool layout_changed = (layout != last_status_layout);
    
    if (layout_changed) {
        last_status_layout = layout;
    }
    
    if (border_changed || layout_changed) {
        last_border_key = border_key;
        // Clear entire screen and redraw border when border changes
        dma_display->clearScreen();
        drawStatusBorder(status_color, border);
        return true; // Border was redrawn
    }
    
    return false; // Border was cached, no redraw needed
}

/**
 * @brief Clear border cache (forces redraw on next call)
 */
void MatrixDisplay::clearBorderCache() {
    last_border_key.clear();
}

/**
 * @brief Get current border cache key (for debugging)
 */
String MatrixDisplay::getBorderCacheKey() const {
    return last_border_key;
}
