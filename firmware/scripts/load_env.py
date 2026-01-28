"""
Load environment variables from .env file and add Supabase build flags.

This script runs as a pre-build step to:
1. Load variables from firmware/.env into the environment
2. Add Supabase URL and anon key as build flags for the firmware
"""

import os
from pathlib import Path

Import("env")  # type: ignore  # noqa: F821  # PlatformIO built-in


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
        for line in f:
            line = line.strip()
            # Skip empty lines and comments
            if not line or line.startswith("#"):
                continue

            # Parse KEY=VALUE
            if "=" in line:
                key, value = line.split("=", 1)
                key = key.strip()
                value = value.strip()

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
        build_flags.append(f'-DDEFAULT_SUPABASE_URL=\\"{supabase_url}\\"')
        print("[load_env] Added build flag: DEFAULT_SUPABASE_URL")
    else:
        print("[load_env] Warning: SUPABASE_URL not set")

    # Supabase Anon Key (for Realtime)
    supabase_anon_key = os.environ.get("SUPABASE_ANON_KEY", "")
    if supabase_anon_key:
        build_flags.append(f'-DDEFAULT_SUPABASE_ANON_KEY=\\"{supabase_anon_key}\\"')
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
