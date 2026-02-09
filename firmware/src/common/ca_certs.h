/**
 * @file ca_certs.h
 * @brief Centralized Root CA certificates for all TLS connections
 *
 * Contains root CA certificates used throughout the firmware:
 * - DigiCert Global Root G2: bridge.5ls.us, GitHub API/CDN (SHA-256, expires 2038)
 * - GlobalSign Root R6: Cloudflare cross-signed chains (SHA-384, expires 2034)
 * - GTS Root R4: Google Trust Services / Cloudflare sites (SHA-256, expires 2036)
 * - IdenTrust Commercial Root CA 1: Cisco Webex API (SHA-256, expires 2034)
 * - ISRG Root X1: Supabase / Let's Encrypt (SHA-256, expires 2035)
 *
 * All certificates use SHA-256 or stronger signature algorithms.
 * No SHA-1 signed certificates are included.
 */

#ifndef CA_CERTS_H
#define CA_CERTS_H

/**
 * GlobalSign Root R6
 * - Used by: Cloudflare cross-signed chains (cloudflare.com, etc.)
 * - Key: RSA 4096-bit
 * - Signature: SHA-384
 * - Valid: 2014-12-10 to 2034-12-10
 * Note: Replaces GlobalSign Root R1 (SHA-1, expired 2028).
 *       Cloudflare uses a cross-signed chain from GlobalSign -> GTS Root R4 -> WE1
 */
extern const char* CA_CERT_GLOBALSIGN_ROOT;

/**
 * DigiCert Global Root G2
 * - Used by: bridge.5ls.us (Cloudflared tunnel)
 * - Key: RSA 2048-bit
 * - Signature: SHA-256
 * - Valid: 2013-08-01 to 2038-01-15
 * Note: bridge.5ls.us uses DigiCert certificate chain, not Cloudflare
 */
extern const char* CA_CERT_DIGICERT_GLOBAL_G2;

/**
 * Google Trust Services Root R4
 * - Used by: Cloudflare sites (cloudflare.com, etc.)
 * - Key: ECC 384-bit (secp384r1)
 * - Signature: SHA-256
 * - Valid: 2016-06-22 to 2036-06-22
 * Note: bridge.5ls.us uses DigiCert, not Cloudflare certificates
 */
extern const char* CA_CERT_GTS_ROOT_R4;

/**
 * DigiCert Global Root G2 (standalone copy)
 * - Used by: github.com, api.github.com, objects.githubusercontent.com
 * - Key: RSA 2048-bit
 * - Signature: SHA-256
 * - Valid: 2013-08-01 to 2038-01-15
 * Note: Replaces legacy DigiCert Global Root CA (SHA-1 signed).
 *       GitHub's certificate chain is trusted by both roots.
 */
extern const char* CA_CERT_DIGICERT_GLOBAL;

/**
 * IdenTrust Commercial Root CA 1
 * - Used by: Cisco Webex API (webexapis.com, api.ciscospark.com)
 * - Key: RSA 4096-bit
 * - Valid: 2014-01-16 to 2034-01-16
 * - Signature: SHA-256
 */
extern const char* CA_CERT_IDENTRUST_COMMERCIAL;

/**
 * ISRG Root X1 (Let's Encrypt)
 * - Used by: Supabase projects (default TLS)
 * - Key: RSA 4096-bit
 * - Signature: SHA-256
 * - Valid: 2015-06-04 to 2035-06-04
 */
extern const char* CA_CERT_ISRG_ROOT_X1;

/**
 * Combined CA bundle for OTA and bridge discovery connections
 * - DigiCert Global Root G2: For GitHub API/CDN (SHA-256, expires 2038)
 * - GTS Root R4: For display.5ls.us (SHA-256, expires 2036)
 * Used by:
 *   - OTA manager: display.5ls.us/updates/manifest.json and GitHub releases
 *   - Bridge discovery: display.5ls.us/api/bridge-config.json
 */
extern const char* CA_CERT_BUNDLE_OTA;

/**
 * CA bundle for Supabase HTTPS connections
 * - Includes ISRG Root X1 (Let's Encrypt) for some Supabase instances
 * - Includes GTS Root R4 (Google Trust Services) for other Supabase instances
 * - Covers all Supabase project URLs (*.supabase.co)
 */
extern const char* CA_CERT_BUNDLE_SUPABASE;

/**
 * CA bundle for Cisco Webex API connections
 * - Uses IdenTrust Commercial Root CA 1
 * - Covers: webexapis.com, api.ciscospark.com, webex.com OAuth endpoints
 */
extern const char* CA_CERT_BUNDLE_WEBEX;

#endif // CA_CERTS_H
