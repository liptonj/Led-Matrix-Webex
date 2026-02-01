/**
 * @file lookup_tables.h
 * @brief Compile-time lookup tables for string/enum mappings
 * 
 * This file replaces if-else chains with efficient lookup tables for O(n) linear
 * search through small datasets. For embedded systems, linear search through
 * constexpr arrays is often faster than hash maps due to cache efficiency and
 * the small dataset sizes.
 * 
 * Usage:
 *   uint16_t color = StatusLookup::getStatusColor("active");
 *   const char* text = StatusLookup::getStatusText("dnd");
 *   const char* month = MonthLookup::getAbbrev(3);  // "MAR"
 */

#ifndef LOOKUP_TABLES_H
#define LOOKUP_TABLES_H

#include <cstdint>
#include <cstring>

// Forward declare Arduino String - will be included by source files
class String;

// ============================================================================
// Status to Color Mapping
// ============================================================================

namespace StatusLookup {

// Color definitions (RGB565 format) - must match matrix_display.h
// Use unique names to avoid macro collisions with COLOR_* defines
constexpr uint16_t STATUS_COLOR_ACTIVE     = 0x07E0;  // Green
constexpr uint16_t STATUS_COLOR_AWAY       = 0xFFE0;  // Yellow
constexpr uint16_t STATUS_COLOR_DND        = 0xF800;  // Red
constexpr uint16_t STATUS_COLOR_BUSY       = 0xF800;  // Red
constexpr uint16_t STATUS_COLOR_OFFLINE    = 0x8410;  // Gray
constexpr uint16_t STATUS_COLOR_OOO        = 0x8010;  // Purple
constexpr uint16_t STATUS_COLOR_PRESENTING = 0xF81F;  // Magenta
constexpr uint16_t STATUS_COLOR_UNKNOWN    = 0x7BEF;  // Light gray

/**
 * Status string to color mapping entry
 */
struct StatusColorEntry {
    const char* status;
    uint16_t color;
};

/**
 * Lookup table for status to color mapping.
 * Order matters for multi-match statuses (first match wins).
 * Listed from most-specific to least-specific aliases.
 */
constexpr StatusColorEntry STATUS_COLOR_TABLE[] = {
    {"active",       STATUS_COLOR_ACTIVE},
    {"inactive",     STATUS_COLOR_AWAY},
    {"away",         STATUS_COLOR_AWAY},
    {"DoNotDisturb", STATUS_COLOR_DND},
    {"dnd",          STATUS_COLOR_DND},
    {"busy",         STATUS_COLOR_BUSY},
    {"meeting",      STATUS_COLOR_BUSY},
    {"call",         STATUS_COLOR_BUSY},
    {"presenting",   STATUS_COLOR_PRESENTING},
    {"OutOfOffice",  STATUS_COLOR_OOO},
    {"ooo",          STATUS_COLOR_OOO},
    {"offline",      STATUS_COLOR_OFFLINE},
};

constexpr size_t STATUS_COLOR_TABLE_SIZE = sizeof(STATUS_COLOR_TABLE) / sizeof(STATUS_COLOR_TABLE[0]);

/**
 * Get color for a status string (case-sensitive match)
 * @param status The status string to look up
 * @return The RGB565 color value, or COLOR_UNKNOWN for unrecognized status
 */
inline uint16_t getStatusColor(const char* status) {
    if (!status || status[0] == '\0') {
        return STATUS_COLOR_OFFLINE;
    }
    
    for (size_t i = 0; i < STATUS_COLOR_TABLE_SIZE; ++i) {
        if (strcmp(status, STATUS_COLOR_TABLE[i].status) == 0) {
            return STATUS_COLOR_TABLE[i].color;
        }
    }
    
    return STATUS_COLOR_UNKNOWN;
}

/**
 * Status string to display text mapping entry
 */
struct StatusTextEntry {
    const char* status;
    const char* text;
};

/**
 * Lookup table for status to display text mapping.
 */
constexpr StatusTextEntry STATUS_TEXT_TABLE[] = {
    {"active",       "AVAILABLE"},
    {"inactive",     "AWAY"},
    {"away",         "AWAY"},
    {"DoNotDisturb", "DO NOT DISTURB"},
    {"dnd",          "DO NOT DISTURB"},
    {"busy",         "BUSY"},
    {"meeting",      "IN A CALL"},
    {"call",         "ON A CALL"},
    {"presenting",   "PRESENTING"},
    {"OutOfOffice",  "OUT OF OFFICE"},
    {"ooo",          "OUT OF OFFICE"},
    {"pending",      "PENDING"},
    {"offline",      "OFFLINE"},
};

constexpr size_t STATUS_TEXT_TABLE_SIZE = sizeof(STATUS_TEXT_TABLE) / sizeof(STATUS_TEXT_TABLE[0]);

/**
 * Get display text for a status string
 * @param status The status string to look up
 * @return The display text, or the original status if not found
 */
inline const char* getStatusText(const char* status) {
    if (!status || status[0] == '\0') {
        return "OFFLINE";
    }
    
    for (size_t i = 0; i < STATUS_TEXT_TABLE_SIZE; ++i) {
        if (strcmp(status, STATUS_TEXT_TABLE[i].status) == 0) {
            return STATUS_TEXT_TABLE[i].text;
        }
    }
    
    // Return original status for unknown values
    return status;
}

} // namespace StatusLookup

// ============================================================================
// Month Abbreviation Lookup
// ============================================================================

namespace MonthLookup {

/**
 * Array of month abbreviations (index 0 is unused, 1-12 are months)
 */
constexpr const char* MONTH_ABBREV[] = {
    "???",  // 0 - invalid
    "JAN",  // 1
    "FEB",  // 2
    "MAR",  // 3
    "APR",  // 4
    "MAY",  // 5
    "JUN",  // 6
    "JUL",  // 7
    "AUG",  // 8
    "SEP",  // 9
    "OCT",  // 10
    "NOV",  // 11
    "DEC",  // 12
};

/**
 * Get month abbreviation by month number (1-12)
 * @param month Month number (1-12)
 * @return Three-letter abbreviation, or "???" for invalid
 */
inline const char* getAbbrev(int month) {
    if (month < 1 || month > 12) {
        return MONTH_ABBREV[0];  // "???"
    }
    return MONTH_ABBREV[month];
}

} // namespace MonthLookup

// ============================================================================
// OTA Update Type Lookup
// ============================================================================

namespace OTALookup {

/**
 * OTA update type enumeration (must match delta_ota.h)
 */
enum class UpdateType : uint8_t {
    FULL_IMAGE = 0,
    COMPRESSED = 1,
    DELTA_PATCH = 2,
    MODULE_ONLY = 3,
    INVALID = 255
};

/**
 * OTA update type string to enum mapping
 */
struct UpdateTypeEntry {
    const char* name;
    UpdateType type;
};

constexpr UpdateTypeEntry UPDATE_TYPE_TABLE[] = {
    {"full",       UpdateType::FULL_IMAGE},
    {"compressed", UpdateType::COMPRESSED},
    {"delta",      UpdateType::DELTA_PATCH},
    {"module",     UpdateType::MODULE_ONLY},
};

constexpr size_t UPDATE_TYPE_TABLE_SIZE = sizeof(UPDATE_TYPE_TABLE) / sizeof(UPDATE_TYPE_TABLE[0]);

/**
 * Get OTA update type from string
 * @param type_str The type string ("full", "compressed", "delta", "module")
 * @return The UpdateType enum value, or INVALID if not recognized
 */
inline UpdateType getUpdateType(const char* type_str) {
    if (!type_str) return UpdateType::INVALID;
    
    for (size_t i = 0; i < UPDATE_TYPE_TABLE_SIZE; ++i) {
        if (strcmp(type_str, UPDATE_TYPE_TABLE[i].name) == 0) {
            return UPDATE_TYPE_TABLE[i].type;
        }
    }
    
    return UpdateType::INVALID;
}

/**
 * Variant name to module bitmask mapping
 */
struct VariantModuleEntry {
    const char* variant;
    uint8_t modules;
};

constexpr VariantModuleEntry VARIANT_MODULE_TABLE[] = {
    {"embedded", 0x21},
    {"standard", 0x23},
    {"sensors",  0x25},
    {"full",     0x37},
};

constexpr size_t VARIANT_MODULE_TABLE_SIZE = sizeof(VARIANT_MODULE_TABLE) / sizeof(VARIANT_MODULE_TABLE[0]);
constexpr uint8_t DEFAULT_MODULE_MASK = 0x01;  // Core only

/**
 * Get module bitmask for a variant name
 * @param variant The variant name
 * @return The module bitmask, or DEFAULT_MODULE_MASK if not found
 */
inline uint8_t getVariantModules(const char* variant) {
    if (!variant) return DEFAULT_MODULE_MASK;
    
    for (size_t i = 0; i < VARIANT_MODULE_TABLE_SIZE; ++i) {
        if (strcmp(variant, VARIANT_MODULE_TABLE[i].variant) == 0) {
            return VARIANT_MODULE_TABLE[i].modules;
        }
    }
    
    return DEFAULT_MODULE_MASK;
}

} // namespace OTALookup

// ============================================================================
// Embedded Status Normalization Lookup
// ============================================================================

namespace EmbeddedStatusLookup {

/**
 * Embedded app status to internal status mapping entry.
 * Maps various status strings from the embedded app to canonical internal values.
 */
struct StatusMapEntry {
    const char* input;    // Input status from embedded app
    const char* output;   // Canonical internal status
    bool sets_in_call;    // Whether this status sets in_call = true
};

/**
 * Status normalization table for embedded app status updates.
 * Maps various input formats to canonical internal status values.
 */
constexpr StatusMapEntry STATUS_MAP_TABLE[] = {
    {"active",        "active",     false},
    {"available",     "active",     false},
    {"away",          "away",       false},
    {"inactive",      "away",       false},
    {"dnd",           "dnd",        false},
    {"donotdisturb",  "dnd",        false},
    {"DoNotDisturb",  "dnd",        false},
    {"presenting",    "presenting", true},
    {"call",          "call",       true},
    {"meeting",       "meeting",    true},
    {"busy",          "meeting",    true},
    {"ooo",           "ooo",        false},
    {"outofoffice",   "ooo",        false},
    {"OutOfOffice",   "ooo",        false},
    {"offline",       "offline",    false},
    {"unknown",       "unknown",    false},
};

constexpr size_t STATUS_MAP_TABLE_SIZE = sizeof(STATUS_MAP_TABLE) / sizeof(STATUS_MAP_TABLE[0]);

/**
 * Result of status normalization lookup
 */
struct NormalizedStatus {
    const char* status;    // Normalized status string
    bool sets_in_call;     // Whether this status sets in_call = true
    bool found;            // Whether the input was found in the table
};

/**
 * Normalize an embedded app status string to internal format
 * @param input The status string from the embedded app
 * @return NormalizedStatus with the result
 */
inline NormalizedStatus normalize(const char* input) {
    if (!input) {
        return {"unknown", false, false};
    }
    
    for (size_t i = 0; i < STATUS_MAP_TABLE_SIZE; ++i) {
        if (strcmp(input, STATUS_MAP_TABLE[i].input) == 0) {
            return {STATUS_MAP_TABLE[i].output, STATUS_MAP_TABLE[i].sets_in_call, true};
        }
    }
    
    // Not found - return input as-is
    return {input, false, false};
}

} // namespace EmbeddedStatusLookup

// ============================================================================
// Date Format Code Lookup
// ============================================================================

namespace DateFormatLookup {

/**
 * Date format string to code mapping entry
 */
struct FormatCodeEntry {
    const char* format;
    uint8_t code;
};

/**
 * Date format lookup table.
 * Code 0 = MDY (default), Code 1 = DMY, Code 2 = Numeric
 */
constexpr FormatCodeEntry FORMAT_CODE_TABLE[] = {
    // DMY formats (code 1)
    {"dmy",      1},
    {"dd/mm",    1},
    {"dd-mm",    1},
    // Numeric formats (code 2)
    {"numeric",  2},
    {"num",      2},
    {"mm/dd",    2},
    {"mm-dd",    2},
    // MDY formats (code 0) - explicit entries
    {"mdy",      0},
    {"default",  0},
};

constexpr size_t FORMAT_CODE_TABLE_SIZE = sizeof(FORMAT_CODE_TABLE) / sizeof(FORMAT_CODE_TABLE[0]);

/**
 * Get date format code from format string (case-insensitive comparison needed)
 * @param format The format string
 * @return Format code (0=MDY, 1=DMY, 2=Numeric), defaults to 0
 */
inline uint8_t getFormatCode(const char* format) {
    if (!format) return 0;
    
    for (size_t i = 0; i < FORMAT_CODE_TABLE_SIZE; ++i) {
        if (strcmp(format, FORMAT_CODE_TABLE[i].format) == 0) {
            return FORMAT_CODE_TABLE[i].code;
        }
    }
    
    return 0;  // Default to MDY
}

} // namespace DateFormatLookup

// ============================================================================
// Time Format Lookup
// ============================================================================

namespace TimeFormatLookup {

/**
 * 12-hour time format strings
 */
constexpr const char* TIME_12H_FORMATS[] = {
    "12h",
    "12",
    "am/pm",
    "ampm",
};

constexpr size_t TIME_12H_FORMATS_SIZE = sizeof(TIME_12H_FORMATS) / sizeof(TIME_12H_FORMATS[0]);

/**
 * Check if format string indicates 12-hour time format
 * @param format The format string (should be lowercase)
 * @return true if 12-hour format, false for 24-hour (default)
 */
inline bool is12HourFormat(const char* format) {
    if (!format) return false;
    
    for (size_t i = 0; i < TIME_12H_FORMATS_SIZE; ++i) {
        if (strcmp(format, TIME_12H_FORMATS[i]) == 0) {
            return true;
        }
    }
    
    return false;  // Default to 24-hour
}

} // namespace TimeFormatLookup

#endif // LOOKUP_TABLES_H
