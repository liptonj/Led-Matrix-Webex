"""
Load environment variables from .env file and add Supabase build flags.

This script runs as a pre-build step to:
1. Load variables from firmware/.env into the environment
2. Add Supabase URL and anon key as build flags for the firmware
"""

import os
import re
from pathlib import Path

Import("env")  # type: ignore  # noqa: F821  # PlatformIO built-in


def is_safe_env_key(key: str) -> bool:
    """Validate environment variable key is safe (alphanumeric + underscore)."""
    return bool(re.match(r"^[A-Za-z_][A-Za-z0-9_]*$", key))


def is_safe_url(value: str) -> bool:
    """Validate URL format (basic validation for Supabase URLs)."""
    # Allow https URLs with alphanumeric, dots, hyphens, and common URL chars
    return bool(re.match(r"^https://[a-zA-Z0-9\-._~:/?#\[\]@!$&\'()*+,;=]+$", value))


def is_safe_anon_key(value: str) -> bool:
    """Validate anon key format (JWT tokens are base64url encoded)."""
    # JWT format: header.payload.signature (base64url + dots)
    return bool(re.match(r"^[A-Za-z0-9_\-]+\.[A-Za-z0-9_\-]+\.[A-Za-z0-9_\-]+$", value))


def sanitize_for_c_string(value: str) -> str:
    """
    Sanitize value for use in C string literal.
    Escapes backslashes and quotes to prevent injection.
    """
    # Escape backslashes first, then quotes
    value = value.replace("\\", "\\\\")
    value = value.replace('"', '\\"')
    return value


def load_dotenv():
    """Load .env file from firmware directory."""
    # PlatformIO runs extra_scripts in a SCons context where __file__ may not exist.
    # Prefer PlatformIO's PROJECT_DIR when available.
    project_dir = env.get("PROJECT_DIR")  # noqa: F821
    if project_dir:
        firmware_dir = Path(project_dir)
    else:
        # Fallback for normal Python execution
        firmware_dir = Path(globals().get("__file__", "")).resolve().parent.parent
    env_file = firmware_dir / ".env"

    if not env_file.exists():
        print(f"[load_env] No .env file found at {env_file}")
        return

    print(f"[load_env] Loading environment from {env_file}")

    with open(env_file, encoding="utf-8") as f:
        for line_num, line in enumerate(f, 1):
            line = line.strip()
            # Skip empty lines and comments
            if not line or line.startswith("#"):
                continue

            # Parse KEY=VALUE
            if "=" in line:
                key, value = line.split("=", 1)
                key = key.strip()
                value = value.strip()

                # Validate key format
                if not is_safe_env_key(key):
                    print(
                        f"[load_env] WARNING: Skipping invalid key on line {line_num}: {key}"
                    )
                    continue

                # Only set if not already in environment (CI takes precedence)
                if key not in os.environ:
                    os.environ[key] = value
                    print(f"[load_env] Set {key}={'*' * min(8, len(value))}...")
                else:
                    print(f"[load_env] Skipping {key} (already set in environment)")


def add_supabase_build_flags():
    """Add Supabase configuration as build flags."""
    build_flags = []

    # Supabase URL
    supabase_url = os.environ.get("SUPABASE_URL", "")
    if supabase_url:
        # Validate URL format before using
        if not is_safe_url(supabase_url):
            print("[load_env] ERROR: SUPABASE_URL format validation failed")
            return

        # Sanitize for C string literal
        safe_url = sanitize_for_c_string(supabase_url)
        build_flags.append(f'-DDEFAULT_SUPABASE_URL=\\"{safe_url}\\"')
        print("[load_env] Added build flag: DEFAULT_SUPABASE_URL")

        # Set OTA manifest URL to point directly to Supabase Edge Function
        manifest_url = f"{supabase_url}/functions/v1/get-manifest"
        safe_manifest_url = sanitize_for_c_string(manifest_url)
        build_flags.append(f'-DDEFAULT_OTA_URL=\\"{safe_manifest_url}\\"')
        build_flags.append(f'-DDEFAULT_OTA_MANIFEST_URL=\\"{safe_manifest_url}\\"')
        print(f"[load_env] Added build flag: DEFAULT_OTA_URL={manifest_url}")
    else:
        print("[load_env] Warning: SUPABASE_URL not set")

    # Supabase Anon Key (for Realtime)
    supabase_anon_key = os.environ.get("SUPABASE_ANON_KEY", "")
    if supabase_anon_key:
        # Validate JWT format
        if not is_safe_anon_key(supabase_anon_key):
            print("[load_env] ERROR: SUPABASE_ANON_KEY format validation failed")
            return

        # Sanitize for C string literal
        safe_key = sanitize_for_c_string(supabase_anon_key)
        build_flags.append(f'-DDEFAULT_SUPABASE_ANON_KEY=\\"{safe_key}\\"')
        print("[load_env] Added build flag: DEFAULT_SUPABASE_ANON_KEY")
    else:
        print(
            "[load_env] Warning: SUPABASE_ANON_KEY not set (Phase B realtime disabled)"
        )

    # Add flags to build environment
    if build_flags:
        env.Append(CPPDEFINES=[])  # noqa: F821
        for flag in build_flags:
            env.Append(BUILD_FLAGS=[flag])  # noqa: F821


# Run on script import
load_dotenv()
add_supabase_build_flags()
