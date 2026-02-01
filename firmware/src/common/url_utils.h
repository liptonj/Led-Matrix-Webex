/**
 * @file url_utils.h
 * @brief URL Encoding Utilities
 * 
 * Shared URL encoding functions to replace duplicated implementations across:
 * - oauth_handler.cpp (OAuth parameter encoding)
 * - api_webex.cpp (Webex auth URL encoding)
 * - supabase_realtime.cpp (WebSocket URL parameter encoding)
 * - api_wifi.cpp (form data URL decoding)
 */

#ifndef URL_UTILS_H
#define URL_UTILS_H

#include <Arduino.h>
#include <ctype.h>

/**
 * @brief URL-encode a string per RFC 3986
 * 
 * Encodes all characters except unreserved characters: A-Z, a-z, 0-9, -, _, ., ~
 * Space is encoded as %20 (not +, which is application/x-www-form-urlencoded)
 * 
 * Use cases:
 * - OAuth URLs (client_id, redirect_uri, scope parameters)
 * - WebSocket connection URLs
 * - Query string parameters
 * 
 * @param str String to URL-encode
 * @return URL-encoded string
 */
inline String urlEncode(const String& str) {
    String encoded = "";
    char c;
    char code0;
    char code1;
    
    for (unsigned int i = 0; i < str.length(); i++) {
        c = str.charAt(i);
        
        // Unreserved characters per RFC 3986
        if (isalnum(c) || c == '-' || c == '_' || c == '.' || c == '~') {
            encoded += c;
        } else {
            // Percent-encode
            code1 = (c & 0xf) + '0';
            if ((c & 0xf) > 9) {
                code1 = (c & 0xf) - 10 + 'A';
            }
            c = (c >> 4) & 0xf;
            code0 = c + '0';
            if (c > 9) {
                code0 = c - 10 + 'A';
            }
            encoded += '%';
            encoded += code0;
            encoded += code1;
        }
    }
    
    return encoded;
}

/**
 * @brief URL-decode a string
 * 
 * Decodes percent-encoded characters and converts + to space
 * (application/x-www-form-urlencoded format)
 * 
 * @param input String to URL-decode
 * @return Decoded string
 */
inline String urlDecode(const String& input) {
    String out;
    out.reserve(input.length());
    
    for (size_t i = 0; i < input.length(); i++) {
        char c = input[i];
        
        if (c == '+') {
            out += ' ';
            continue;
        }
        
        if (c == '%' && i + 2 < input.length()) {
            char hex[3] = { input[i + 1], input[i + 2], 0 };
            out += static_cast<char>(strtol(hex, nullptr, 16));
            i += 2;
            continue;
        }
        
        out += c;
    }
    
    return out;
}

#endif // URL_UTILS_H
