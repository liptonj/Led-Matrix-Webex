/**
 * @file display_datetime.cpp
 * @brief Date/Time Line Rendering Functions
 * 
 * Contains functions for rendering formatted date and time information
 * using tiny font for compact display.
 */

#include "matrix_display.h"

void MatrixDisplay::drawDateTimeLine(int y, const DisplayData& data, uint16_t date_color, uint16_t time_color) {
    // Call overloaded version with full width for backward compatibility
    drawDateTimeLine(y, data, date_color, time_color, 0, MATRIX_WIDTH);
}

void MatrixDisplay::drawDateTimeLine(int y, const DisplayData& data, uint16_t date_color, uint16_t time_color,
                                     int content_x, int content_width) {
    String date_text = formatDate(data.month, data.day, data.date_format);
    if (!isTinyRenderable(date_text)) {
        date_text = String(data.month) + "/" + String(data.day);
    }

    String time_text = data.use_24h
        ? formatTime24(data.hour, data.minute)
        : formatTime(data.hour, data.minute);
    if (!isTinyRenderable(time_text)) {
        time_text = formatTime24(data.hour, data.minute);
    }

    int time_width = tinyTextWidth(time_text);
    int date_width = tinyTextWidth(date_text);
    const int min_gap = 4;

    if (date_width + min_gap + time_width <= content_width) {
        drawTinyText(content_x, y, date_text, date_color);
        int time_x = content_x + content_width - time_width;
        drawTinyText(time_x, y, time_text, time_color);
    } else {
        date_text = String(data.month) + "/" + String(data.day);
        date_width = tinyTextWidth(date_text);

        if (date_width + min_gap + time_width <= content_width) {
            drawTinyText(content_x, y, date_text, date_color);
            int time_x = content_x + content_width - time_width;
            drawTinyText(time_x, y, time_text, time_color);
        } else {
            int time_x = content_x + content_width - time_width;
            if (time_x < content_x) time_x = content_x;
            drawTinyText(time_x, y, time_text, time_color);
        }
    }
}
