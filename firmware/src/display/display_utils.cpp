/**
 * @file display_utils.cpp
 * @brief Display Utility Functions
 * 
 * Contains formatting helpers for time, date, and status text/colors.
 */

#include "matrix_display.h"
#include "display_fonts.h"

uint16_t MatrixDisplay::getStatusColor(const String& status) {
    if (status == "active") return COLOR_ACTIVE;
    if (status == "inactive" || status == "away") return COLOR_AWAY;
    if (status == "DoNotDisturb" || status == "dnd") return COLOR_DND;
    if (status == "busy" || status == "meeting") return COLOR_BUSY;
    if (status == "OutOfOffice" || status == "ooo") return COLOR_OOO;
    return COLOR_OFFLINE;
}

String MatrixDisplay::getStatusText(const String& status) {
    if (status == "active") return "AVAILABLE";
    if (status == "inactive" || status == "away") return "AWAY";
    if (status == "DoNotDisturb" || status == "dnd") return "DND";
    if (status == "busy") return "BUSY";
    if (status == "meeting") return "IN A CALL";
    if (status == "OutOfOffice" || status == "ooo") return "OOO";
    if (status == "pending") return "PENDING";
    return "OFFLINE";
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
    switch (month) {
        case 1: return "JAN";
        case 2: return "FEB";
        case 3: return "MAR";
        case 4: return "APR";
        case 5: return "MAY";
        case 6: return "JUN";
        case 7: return "JUL";
        case 8: return "AUG";
        case 9: return "SEP";
        case 10: return "OCT";
        case 11: return "NOV";
        case 12: return "DEC";
        default: return "???";
    }
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
