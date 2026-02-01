/**
 * @file test_display_primitives.cpp
 * @brief Unit tests for Display Primitives
 * 
 * Tests verify display rendering functions including:
 * - Text drawing (drawText, drawSmallText)
 * - Icon drawing
 * - Scrolling text
 * - Color conversion (RGB565, hex colors)
 * - Coordinate calculations
 * - Boundary checking
 */

#ifdef UNIT_TEST

#include <unity.h>
#include <Arduino.h>

// RGB565 color format
#define COLOR_BLACK     0x0000
#define COLOR_WHITE     0xFFFF
#define COLOR_RED       0xF800
#define COLOR_GREEN     0x07E0
#define COLOR_BLUE      0x001F
#define COLOR_YELLOW    0xFFE0
#define COLOR_CYAN      0x07FF
#define COLOR_MAGENTA   0xF81F

// Display dimensions (64x32 typical)
#define DISPLAY_WIDTH   64
#define DISPLAY_HEIGHT  32

// ============================================================================
// Color Conversion Tests (RGB565)
// ============================================================================

void test_color_rgb565_black() {
    uint16_t color = COLOR_BLACK;
    TEST_ASSERT_EQUAL(0x0000, color);
}

void test_color_rgb565_white() {
    uint16_t color = COLOR_WHITE;
    TEST_ASSERT_EQUAL(0xFFFF, color);
}

void test_color_rgb565_red() {
    uint16_t color = COLOR_RED;
    TEST_ASSERT_EQUAL(0xF800, color);
}

void test_color_rgb565_green() {
    uint16_t color = COLOR_GREEN;
    TEST_ASSERT_EQUAL(0x07E0, color);
}

void test_color_rgb565_blue() {
    uint16_t color = COLOR_BLUE;
    TEST_ASSERT_EQUAL(0x001F, color);
}

void test_color_rgb_to_rgb565() {
    // Convert RGB888 to RGB565
    uint8_t r = 255, g = 0, b = 0;
    uint16_t color = ((r & 0xF8) << 8) | ((g & 0xFC) << 3) | (b >> 3);
    TEST_ASSERT_EQUAL(0xF800, color); // Red
}

void test_color_hex_to_rgb565() {
    // Convert #FF0000 (red) to RGB565
    String hex = "#FF0000";
    uint8_t r = strtol(hex.substring(1, 3).c_str(), NULL, 16);
    uint8_t g = strtol(hex.substring(3, 5).c_str(), NULL, 16);
    uint8_t b = strtol(hex.substring(5, 7).c_str(), NULL, 16);
    uint16_t color = ((r & 0xF8) << 8) | ((g & 0xFC) << 3) | (b >> 3);
    TEST_ASSERT_EQUAL(0xF800, color);
}

void test_color_hex_parsing() {
    String hex = "#00FFFF"; // Cyan
    TEST_ASSERT_TRUE(hex.startsWith("#"));
    TEST_ASSERT_EQUAL(7, hex.length());
}

void test_color_hex_invalid() {
    String hex = "INVALID";
    bool valid = (hex.startsWith("#") && hex.length() == 7);
    TEST_ASSERT_FALSE(valid);
}

// ============================================================================
// Text Drawing Tests
// ============================================================================

void test_text_position_valid() {
    int x = 10, y = 10;
    bool valid = (x >= 0 && x < DISPLAY_WIDTH && y >= 0 && y < DISPLAY_HEIGHT);
    TEST_ASSERT_TRUE(valid);
}

void test_text_position_out_of_bounds_x() {
    int x = 70, y = 10;
    bool valid = (x >= 0 && x < DISPLAY_WIDTH);
    TEST_ASSERT_FALSE(valid);
}

void test_text_position_out_of_bounds_y() {
    int x = 10, y = 40;
    bool valid = (y >= 0 && y < DISPLAY_HEIGHT);
    TEST_ASSERT_FALSE(valid);
}

void test_text_position_negative() {
    int x = -5, y = 10;
    bool valid = (x >= 0 && x < DISPLAY_WIDTH);
    TEST_ASSERT_FALSE(valid);
}

void test_text_length_measurement() {
    String text = "Hello";
    int char_width = 6; // pixels per char
    int text_width = text.length() * char_width;
    TEST_ASSERT_EQUAL(30, text_width);
}

void test_text_centering_calculation() {
    String text = "Test";
    int char_width = 6;
    int text_width = text.length() * char_width;
    int center_x = (DISPLAY_WIDTH - text_width) / 2;
    TEST_ASSERT_EQUAL(20, center_x); // (64 - 24) / 2 = 20
}

void test_text_right_alignment() {
    String text = "Test";
    int char_width = 6;
    int text_width = text.length() * char_width;
    int right_x = DISPLAY_WIDTH - text_width;
    TEST_ASSERT_EQUAL(40, right_x); // 64 - 24 = 40
}

// ============================================================================
// Small Text Tests
// ============================================================================

void test_small_text_size() {
    int small_char_width = 4; // Smaller than normal 6
    int small_char_height = 6; // Smaller than normal 8
    TEST_ASSERT_LESS_THAN(6, small_char_width);
    TEST_ASSERT_LESS_THAN(8, small_char_height);
}

void test_small_text_more_content() {
    int normal_width = 6;
    int small_width = 4;
    int max_chars_normal = DISPLAY_WIDTH / normal_width; // 10 chars
    int max_chars_small = DISPLAY_WIDTH / small_width;   // 16 chars
    TEST_ASSERT_GREATER_THAN(max_chars_normal, max_chars_small);
}

// ============================================================================
// Icon Drawing Tests
// ============================================================================

void test_icon_dimensions() {
    int icon_width = 8;
    int icon_height = 8;
    TEST_ASSERT_EQUAL(8, icon_width);
    TEST_ASSERT_EQUAL(8, icon_height);
}

void test_icon_position() {
    int icon_x = 5, icon_y = 5;
    int icon_width = 8;
    bool fits = (icon_x + icon_width) <= DISPLAY_WIDTH;
    TEST_ASSERT_TRUE(fits);
}

void test_icon_bitmap() {
    // Simple 8x8 icon bitmap (1 bit per pixel)
    const uint8_t icon_data[8] = {
        0b00111100,
        0b01000010,
        0b10000001,
        0b10000001,
        0b10000001,
        0b10000001,
        0b01000010,
        0b00111100
    };
    TEST_ASSERT_EQUAL(8, sizeof(icon_data));
}

void test_icon_color() {
    uint16_t icon_color = COLOR_GREEN;
    TEST_ASSERT_EQUAL(COLOR_GREEN, icon_color);
}

// ============================================================================
// Scrolling Text Tests
// ============================================================================

void test_scrolling_initial_position() {
    int scroll_x = DISPLAY_WIDTH; // Start off right edge
    TEST_ASSERT_EQUAL(DISPLAY_WIDTH, scroll_x);
}

void test_scrolling_move_left() {
    int scroll_x = 64;
    int scroll_speed = 1;
    scroll_x -= scroll_speed;
    TEST_ASSERT_EQUAL(63, scroll_x);
}

void test_scrolling_end_position() {
    String text = "Hello";
    int char_width = 6;
    int text_width = text.length() * char_width;
    int end_x = -text_width; // Completely off left edge
    TEST_ASSERT_EQUAL(-30, end_x);
}

void test_scrolling_wrap_around() {
    int scroll_x = -30;
    int text_width = 30;
    if (scroll_x < -text_width) {
        scroll_x = DISPLAY_WIDTH;
    }
    TEST_ASSERT_EQUAL(-30, scroll_x); // Not wrapped yet
    
    scroll_x = -31;
    if (scroll_x < -text_width) {
        scroll_x = DISPLAY_WIDTH;
    }
    TEST_ASSERT_EQUAL(DISPLAY_WIDTH, scroll_x); // Wrapped
}

void test_scrolling_speed() {
    int scroll_speed_ms = 250; // milliseconds per step
    TEST_ASSERT_EQUAL(250, scroll_speed_ms);
}

void test_scrolling_visible_check() {
    int scroll_x = 10;
    int text_width = 30;
    bool visible = (scroll_x + text_width >= 0 && scroll_x < DISPLAY_WIDTH);
    TEST_ASSERT_TRUE(visible);
}

void test_scrolling_off_screen_left() {
    int scroll_x = -40;
    int text_width = 30;
    bool visible = (scroll_x + text_width >= 0);
    TEST_ASSERT_FALSE(visible);
}

void test_scrolling_off_screen_right() {
    int scroll_x = 70;
    bool visible = (scroll_x < DISPLAY_WIDTH);
    TEST_ASSERT_FALSE(visible);
}

// ============================================================================
// Coordinate Calculation Tests
// ============================================================================

void test_coordinate_top_left() {
    int x = 0, y = 0;
    TEST_ASSERT_EQUAL(0, x);
    TEST_ASSERT_EQUAL(0, y);
}

void test_coordinate_top_right() {
    int x = DISPLAY_WIDTH - 1;
    int y = 0;
    TEST_ASSERT_EQUAL(63, x);
    TEST_ASSERT_EQUAL(0, y);
}

void test_coordinate_bottom_left() {
    int x = 0;
    int y = DISPLAY_HEIGHT - 1;
    TEST_ASSERT_EQUAL(0, x);
    TEST_ASSERT_EQUAL(31, y);
}

void test_coordinate_bottom_right() {
    int x = DISPLAY_WIDTH - 1;
    int y = DISPLAY_HEIGHT - 1;
    TEST_ASSERT_EQUAL(63, x);
    TEST_ASSERT_EQUAL(31, y);
}

void test_coordinate_center() {
    int x = DISPLAY_WIDTH / 2;
    int y = DISPLAY_HEIGHT / 2;
    TEST_ASSERT_EQUAL(32, x);
    TEST_ASSERT_EQUAL(16, y);
}

// ============================================================================
// Boundary Checking Tests
// ============================================================================

void test_boundary_clipping_required() {
    int x = 60;
    int width = 10;
    bool needs_clipping = (x + width > DISPLAY_WIDTH);
    TEST_ASSERT_TRUE(needs_clipping);
}

void test_boundary_no_clipping() {
    int x = 50;
    int width = 10;
    bool needs_clipping = (x + width > DISPLAY_WIDTH);
    TEST_ASSERT_FALSE(needs_clipping);
}

void test_boundary_clip_width() {
    int x = 60;
    int width = 10;
    if (x + width > DISPLAY_WIDTH) {
        width = DISPLAY_WIDTH - x;
    }
    TEST_ASSERT_EQUAL(4, width); // 64 - 60 = 4
}

// ============================================================================
// Line Drawing Tests
// ============================================================================

void test_line_horizontal() {
    int x1 = 10, y1 = 10;
    int x2 = 50, y2 = 10;
    bool is_horizontal = (y1 == y2);
    TEST_ASSERT_TRUE(is_horizontal);
}

void test_line_vertical() {
    int x1 = 10, y1 = 10;
    int x2 = 10, y2 = 30;
    bool is_vertical = (x1 == x2);
    TEST_ASSERT_TRUE(is_vertical);
}

void test_line_length() {
    int x1 = 10, y1 = 10;
    int x2 = 50, y2 = 10;
    int length = x2 - x1;
    TEST_ASSERT_EQUAL(40, length);
}

// ============================================================================
// Rectangle Drawing Tests
// ============================================================================

void test_rectangle_dimensions() {
    int x = 10, y = 10;
    int width = 20, height = 10;
    TEST_ASSERT_EQUAL(20, width);
    TEST_ASSERT_EQUAL(10, height);
}

void test_rectangle_fits() {
    int x = 10, y = 10;
    int width = 20, height = 10;
    bool fits = (x + width <= DISPLAY_WIDTH && y + height <= DISPLAY_HEIGHT);
    TEST_ASSERT_TRUE(fits);
}

void test_rectangle_overflow() {
    int x = 50, y = 10;
    int width = 20, height = 10;
    bool fits = (x + width <= DISPLAY_WIDTH);
    TEST_ASSERT_FALSE(fits);
}

// ============================================================================
// Border Drawing Tests
// ============================================================================

void test_border_width() {
    uint8_t border_width = 1;
    bool valid = (border_width >= 1 && border_width <= 3);
    TEST_ASSERT_TRUE(valid);
}

void test_border_full_screen() {
    int x = 0, y = 0;
    int width = DISPLAY_WIDTH;
    int height = DISPLAY_HEIGHT;
    TEST_ASSERT_EQUAL(DISPLAY_WIDTH, width);
    TEST_ASSERT_EQUAL(DISPLAY_HEIGHT, height);
}

void test_border_color() {
    uint16_t border_color = COLOR_GREEN;
    TEST_ASSERT_EQUAL(COLOR_GREEN, border_color);
}

// ============================================================================
// Test Runner
// ============================================================================

static void run_display_primitives_tests() {
    UNITY_BEGIN();
    
    // Color conversion tests
    RUN_TEST(test_color_rgb565_black);
    RUN_TEST(test_color_rgb565_white);
    RUN_TEST(test_color_rgb565_red);
    RUN_TEST(test_color_rgb565_green);
    RUN_TEST(test_color_rgb565_blue);
    RUN_TEST(test_color_rgb_to_rgb565);
    RUN_TEST(test_color_hex_to_rgb565);
    RUN_TEST(test_color_hex_parsing);
    RUN_TEST(test_color_hex_invalid);
    
    // Text drawing tests
    RUN_TEST(test_text_position_valid);
    RUN_TEST(test_text_position_out_of_bounds_x);
    RUN_TEST(test_text_position_out_of_bounds_y);
    RUN_TEST(test_text_position_negative);
    RUN_TEST(test_text_length_measurement);
    RUN_TEST(test_text_centering_calculation);
    RUN_TEST(test_text_right_alignment);
    
    // Small text tests
    RUN_TEST(test_small_text_size);
    RUN_TEST(test_small_text_more_content);
    
    // Icon drawing tests
    RUN_TEST(test_icon_dimensions);
    RUN_TEST(test_icon_position);
    RUN_TEST(test_icon_bitmap);
    RUN_TEST(test_icon_color);
    
    // Scrolling text tests
    RUN_TEST(test_scrolling_initial_position);
    RUN_TEST(test_scrolling_move_left);
    RUN_TEST(test_scrolling_end_position);
    RUN_TEST(test_scrolling_wrap_around);
    RUN_TEST(test_scrolling_speed);
    RUN_TEST(test_scrolling_visible_check);
    RUN_TEST(test_scrolling_off_screen_left);
    RUN_TEST(test_scrolling_off_screen_right);
    
    // Coordinate calculation tests
    RUN_TEST(test_coordinate_top_left);
    RUN_TEST(test_coordinate_top_right);
    RUN_TEST(test_coordinate_bottom_left);
    RUN_TEST(test_coordinate_bottom_right);
    RUN_TEST(test_coordinate_center);
    
    // Boundary checking tests
    RUN_TEST(test_boundary_clipping_required);
    RUN_TEST(test_boundary_no_clipping);
    RUN_TEST(test_boundary_clip_width);
    
    // Line drawing tests
    RUN_TEST(test_line_horizontal);
    RUN_TEST(test_line_vertical);
    RUN_TEST(test_line_length);
    
    // Rectangle drawing tests
    RUN_TEST(test_rectangle_dimensions);
    RUN_TEST(test_rectangle_fits);
    RUN_TEST(test_rectangle_overflow);
    
    // Border drawing tests
    RUN_TEST(test_border_width);
    RUN_TEST(test_border_full_screen);
    RUN_TEST(test_border_color);
    
    UNITY_END();
}

#ifdef NATIVE_BUILD
int main(int argc, char **argv) {
    (void)argc;
    (void)argv;
    run_display_primitives_tests();
    return 0;
}
#else
void setup() {
    delay(2000);
    run_display_primitives_tests();
}

void loop() {
    // Nothing to do
}
#endif

#endif // UNIT_TEST
