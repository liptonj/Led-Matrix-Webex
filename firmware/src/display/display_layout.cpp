/**
 * @file display_layout.cpp
 * @brief Layout Calculation Functions
 *
 * Calculates content areas, line positions, and spacing
 * based on border width and available space.
 */

#include "matrix_display.h"

// Line height constant
static const int LINE_HEIGHT = 8;

/**
 * @brief Calculate content area based on border width
 * 
 * @param border Border width (already clamped)
 * @param content_x Output: X position of content area
 * @param content_width Output: Width of content area
 */
void MatrixDisplay::calculateContentArea(int border, int& content_x, int& content_width) {
    content_x = border;
    content_width = MATRIX_WIDTH - 2 * border;
}

/**
 * @brief Calculate available height and max lines
 * 
 * @param border Border width (already clamped)
 * @param available_height Output: Available height for content
 * @param max_lines Output: Maximum number of lines that fit
 */
void MatrixDisplay::calculateAvailableHeight(int border, int& available_height, int& max_lines) {
    available_height = MATRIX_HEIGHT - (2 * border);
    max_lines = available_height / LINE_HEIGHT;
}

/**
 * @brief Calculate extra spacing after status line
 * 
 * @param available_height Available height for content
 * @return Extra spacing in pixels (0 or 2)
 */
int MatrixDisplay::calculateExtraSpacing(int available_height) {
    // Only add extra spacing if we have room for 4 lines (needed room: 4*8 + 2 = 34px)
    // With 1px border: available = 30px, so we can't fit 4 lines + 2px spacing
    // Solution: use 1px spacing when tight on space, 2px when there's room
    const bool tight_fit = (available_height < 34); // Less than 34px means can't fit 4 lines + 2px spacing
    return tight_fit ? 0 : 2; // No spacing if tight, 2px if room
}

/**
 * @brief Calculate line Y positions
 * 
 * @param border Border width (already clamped)
 * @param extra_spacing Extra spacing after first line
 * @param line0_y Output: Y position of line 0
 * @param line1_y Output: Y position of line 1
 * @param line2_y Output: Y position of line 2
 * @param line3_y Output: Y position of line 3
 */
void MatrixDisplay::calculateLinePositions(int border, int extra_spacing,
                                            int& line0_y, int& line1_y, 
                                            int& line2_y, int& line3_y) {
    line0_y = border + LINE_HEIGHT * 0;
    line1_y = border + LINE_HEIGHT * 1 + extra_spacing;
    line2_y = border + LINE_HEIGHT * 2 + extra_spacing; // Shift down by spacing to prevent overlap
    line3_y = border + LINE_HEIGHT * 3 + extra_spacing; // Shift down by spacing to prevent overlap
}

/**
 * @brief Calculate line Y positions without extra spacing
 * 
 * @param border Border width (already clamped)
 * @param line0_y Output: Y position of line 0
 * @param line1_y Output: Y position of line 1
 * @param line2_y Output: Y position of line 2
 * @param line3_y Output: Y position of line 3
 */
void MatrixDisplay::calculateLinePositions(int border,
                                            int& line0_y, int& line1_y, 
                                            int& line2_y, int& line3_y) {
    line0_y = border + LINE_HEIGHT * 0;
    line1_y = border + LINE_HEIGHT * 1;
    line2_y = border + LINE_HEIGHT * 2;
    line3_y = border + LINE_HEIGHT * 3;
}

/**
 * @brief Get line height constant
 */
int MatrixDisplay::getLineHeight() const {
    return LINE_HEIGHT;
}
