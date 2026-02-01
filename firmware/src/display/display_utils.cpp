/**
 * @file display_utils.cpp
 * @brief Display Utility Functions
 * 
 * Contains formatting helpers for time, date, and status text/colors.
 */

#include "matrix_display.h"
#include "display_fonts.h"
#include "common/lookup_tables.h"

uint16_t MatrixDisplay::getStatusColor(const String& status) {
    if (status.isEmpty()) {
        return COLOR_OFFLINE;
    }
    return StatusLookup::getStatusColor(status.c_str());
}

String MatrixDisplay::getStatusText(const String& status) {
    if (status.isEmpty()) {
        return "OFFLINE";
    }
    return String(StatusLookup::getStatusText(status.c_str()));
}

String MatrixDisplay::formatTime(int hour, int minute) {
    // Convert to 12-hour format with AM/PM
    bool is_pm = hour >= 12;
    int hour12 = hour % 12;
    if (hour12 == 0) hour12 = 12;

    char time_str[12];
    snprintf(time_str, sizeof(time_str), "%d:%02d%s", hour12, minute, is_pm ? "PM" : "AM");
    return String(time_str);
}

String MatrixDisplay::formatTime24(int hour, int minute) {
    char time_str[8];
    snprintf(time_str, sizeof(time_str), "%02d:%02d", hour, minute);
    return String(time_str);
}

String MatrixDisplay::formatDate(int month, int day, uint8_t format) {
    char date_str[8];
    if (format == 1) {
        snprintf(date_str, sizeof(date_str), "%d%s", day, getMonthAbbrev(month).c_str());
        return String(date_str);
    }
    if (format == 2) {
        snprintf(date_str, sizeof(date_str), "%02d/%02d", month, day);
        return String(date_str);
    }
    snprintf(date_str, sizeof(date_str), "%s%d", getMonthAbbrev(month).c_str(), day);
    return String(date_str);
}

String MatrixDisplay::getMonthAbbrev(int month) {
    return String(MonthLookup::getAbbrev(month));
}

String MatrixDisplay::normalizeIpText(const String& input) {
    String out;
    out.reserve(input.length());
    char last = '\0';
    for (size_t i = 0; i < input.length(); i++) {
        char c = input[i];
        if (c == '.' && last == '.') {
            continue;
        }
        out += c;
        last = c;
    }
    return out;
}

String MatrixDisplay::sanitizeSingleLine(const String& input) {
    String out = input;
    out.replace('\r', ' ');
    out.replace('\n', ' ');
    return out;
}

int MatrixDisplay::tinyTextWidth(const String& text) const {
    if (text.isEmpty()) {
        return 0;
    }
    return (int)(text.length() * 4 - 1);
}

bool MatrixDisplay::isTinyRenderable(const String& text) const {
    for (size_t i = 0; i < text.length(); i++) {
        if (!DisplayFonts::isRenderable(text[i])) {
            return false;
        }
    }
    return true;
}
