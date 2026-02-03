/**
 * @file display_helpers.h
 * @brief Helper classes for building display screens
 * 
 * @note This helper class requires MatrixDisplay to declare StaticScreenBuilder as a friend
 *       to access private drawing methods. Add this line to matrix_display.h in the private section:
 *       `friend class StaticScreenBuilder;`
 */

#ifndef DISPLAY_HELPERS_H
#define DISPLAY_HELPERS_H

#include <Arduino.h>
#include "matrix_display.h"

/**
 * @brief Helper class for building static display screens
 * 
 * Encapsulates the common pattern of:
 * - Checking if screen has changed
 * - Clearing screen on change
 * - Drawing static content only once
 * - Drawing dynamic content every frame
 * 
 * Usage example:
 * @code
 * void MatrixDisplay::showMyScreen(const String& param) {
 *     if (!initialized) return;
 *     
 *     const String screen_key = "prefix:" + param;
 *     StaticScreenBuilder builder(this, screen_key, last_static_key);
 *     
 *     if (builder.hasChanged()) {
 *         builder.clearScreen();
 *         builder.drawTitle("TITLE", COLOR_CYAN);
 *         builder.drawLine(1, "Static text", COLOR_WHITE);
 *     }
 *     
 *     // Dynamic content (drawn every frame)
 *     drawScrollingText(builder.getLineY(2), dynamic_text, COLOR_YELLOW, 
 *                       MATRIX_WIDTH - 4, builder.getScrollKey("dynamic"));
 * }
 * @endcode
 */
class StaticScreenBuilder {
public:
    /**
     * @brief Construct a StaticScreenBuilder
     * 
     * @param display Pointer to MatrixDisplay instance
     * @param screen_key Unique key identifying this screen (e.g., "ap:192.168.1.1")
     * @param last_static_key_ref Reference to MatrixDisplay::last_static_key (for tracking screen changes)
     * 
     * @note The last_static_key_ref parameter is required because last_static_key is private.
     *       When used from within MatrixDisplay methods, pass last_static_key directly.
     */
    StaticScreenBuilder(MatrixDisplay* display, const String& screen_key, String& last_static_key_ref);
    
    /**
     * @brief Returns true if this is a new screen (content should be redrawn)
     * 
     * Checks if the screen_key differs from the last displayed screen.
     * If true, static content should be redrawn.
     */
    bool hasChanged() const { return _changed; }
    
    /**
     * @brief Clear the display (call only when hasChanged() is true)
     * 
     * Clears the entire display screen.
     */
    void clearScreen();
    
    /**
     * @brief Draw title text at top of screen (centered)
     * 
     * @param text Title text to display
     * @param color Text color (RGB565 format)
     */
    void drawTitle(const String& text, uint16_t color);
    
    /**
     * @brief Draw text at a specific line (0-3 for 64x32 display)
     * 
     * Uses default line height of 8 pixels with no top offset.
     * 
     * @param line Line index (0-3)
     * @param text Text to display
     * @param color Text color (RGB565 format)
     */
    void drawLine(int line, const String& text, uint16_t color);
    
    /**
     * @brief Draw text at a specific line with custom line height and offset
     * 
     * @param line Line index
     * @param line_height Height of each line in pixels (default 8)
     * @param top_offset Top offset in pixels (default 0)
     * @param text Text to display
     * @param color Text color (RGB565 format)
     */
    void drawLine(int line, int line_height, int top_offset, const String& text, uint16_t color);
    
    /**
     * @brief Draw centered text at a specific y position
     * 
     * @param y Y position in pixels
     * @param text Text to display
     * @param color Text color (RGB565 format)
     */
    void drawCentered(int y, const String& text, uint16_t color);
    
    /**
     * @brief Draw separator line at y position
     * 
     * @param y Y position for the separator line
     * @param color Line color (default COLOR_GRAY)
     */
    void drawSeparator(int y, uint16_t color = COLOR_GRAY);
    
    /**
     * @brief Get Y position for a specific line
     * 
     * Uses default line height of 8 pixels with no top offset.
     * 
     * @param line Line index (0-3)
     * @return Y position in pixels
     */
    int getLineY(int line) const;
    
    /**
     * @brief Get Y position for a specific line with custom line height
     * 
     * @param line Line index
     * @param line_height Height of each line in pixels
     * @return Y position in pixels
     */
    int getLineY(int line, int line_height) const;
    
    /**
     * @brief Get Y position for a specific line with custom parameters
     * 
     * @param line Line index
     * @param line_height Height of each line in pixels (default 8)
     * @param top_offset Top offset in pixels (default 0)
     * @return Y position in pixels
     */
    int getLineY(int line, int line_height, int top_offset) const;
    
    /**
     * @brief Get the unique key for scrolling text
     * 
     * Creates a unique key by combining the screen key with a suffix.
     * This ensures scrolling state is tracked per screen instance.
     * 
     * @param suffix Suffix to append (e.g., "ip", "hostname")
     * @return Unique scroll key (e.g., "ap:192.168.1.1_ip")
     */
    String getScrollKey(const String& suffix) const;
    
    /**
     * @brief Get the screen key
     * 
     * @return The screen key used to identify this screen
     */
    String getScreenKey() const { return _key; }

private:
    MatrixDisplay* _display;
    String _key;
    bool _changed;
    String* _last_static_key_ref;  // Reference to MatrixDisplay::last_static_key
};

#endif // DISPLAY_HELPERS_H
