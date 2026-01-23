"""
PlatformIO post-build script to patch the ESP32 app descriptor version.

This script patches the firmware binary to replace the ESP-IDF version
with our actual firmware version in the esp_app_desc_t structure.
"""
# pylint: disable=undefined-variable,used-before-assignment
# pyright: reportUndefinedVariable=false, reportUnboundVariable=false
# mypy: disable-error-code="name-defined"
import struct
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from SCons.Script import Environment  # type: ignore[import-not-found]

# Declare SCons globals for type checkers - these are injected by PlatformIO
Import: Any  # noqa: F821
env: "Environment"  # noqa: F821

Import("env")  # noqa: F821


def patch_app_descriptor(source, target, env):
    """Patch the app descriptor in the firmware binary with correct version."""
    firmware_path = str(target[0])
    
    # Get firmware version from platformio.ini
    try:
        import configparser
        import os
        ini_path = os.path.join(env.subst("$PROJECT_DIR"), "platformio.ini")
        config = configparser.ConfigParser()
        config.read(ini_path)
        if config.has_option("version", "firmware_version"):
            firmware_version = config.get("version", "firmware_version").strip()
        else:
            firmware_version = "1.0.0"
    except Exception as e:
        print(f"[PATCH] Warning: Could not read version from platformio.ini: {e}")
        firmware_version = "1.0.0"
    
    print(f"[PATCH] Patching app descriptor with version: {firmware_version}")
    
    try:
        with open(firmware_path, 'rb') as f:
            data = bytearray(f.read())
        
        # Look for the app descriptor magic (0xABCD5432 in little-endian)
        magic = struct.pack('<I', 0xABCD5432)
        pos = data.find(magic)
        
        if pos == -1:
            print("[PATCH] Warning: App descriptor not found in binary")
            return
        
        print(f"[PATCH] Found app descriptor at offset {pos}")
        
        # App descriptor structure (esp_app_desc_t):
        # uint32_t magic_word;        // offset 0, 4 bytes
        # uint32_t secure_version;    // offset 4, 4 bytes  
        # uint32_t reserv1[2];        // offset 8, 8 bytes
        # char version[32];           // offset 16, 32 bytes <-- THIS IS WHAT WE PATCH
        # char project_name[32];      // offset 48, 32 bytes
        # char time[16];              // offset 80, 16 bytes
        # char date[16];              // offset 96, 16 bytes
        # char idf_ver[32];           // offset 112, 32 bytes
        # uint8_t app_elf_sha256[32]; // offset 144, 32 bytes
        # uint32_t reserv2[20];       // offset 176, 80 bytes
        
        version_offset = pos + 16
        
        # Ensure version string fits in 32 bytes (including null terminator)
        if len(firmware_version) > 31:
            firmware_version = firmware_version[:31]
        
        # Create version bytes (32 bytes, null-padded)
        version_bytes = firmware_version.encode('utf-8')
        version_bytes += b'\x00' * (32 - len(version_bytes))
        
        # Patch the version field
        data[version_offset:version_offset+32] = version_bytes
        
        # Write patched binary
        with open(firmware_path, 'wb') as f:
            f.write(data)
        
        print(f"[PATCH] Successfully patched version to: {firmware_version}")
        
        # Verify the patch
        with open(firmware_path, 'rb') as f:
            verify_data = f.read()
            verify_pos = verify_data.find(magic)
            if verify_pos != -1:
                verify_version = verify_data[verify_pos+16:verify_pos+48].decode('utf-8', errors='ignore').rstrip('\x00')
                print(f"[PATCH] Verification: Version in binary is now: {verify_version}")
            
    except Exception as e:
        print(f"[PATCH] Error patching binary: {e}")
        import traceback
        traceback.print_exc()


# Add post-build action to patch the firmware binary
env.AddPostAction("$BUILD_DIR/${PROGNAME}.bin", patch_app_descriptor)
print("[PATCH] App descriptor patcher registered")
