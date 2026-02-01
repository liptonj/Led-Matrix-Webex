# mypy: ignore-errors
"""
OTA and Upload Scripts for ESP32 Firmware with Bootstrap Protection.

IMPORTANT: This script overrides PlatformIO's default upload behavior to
protect the bootstrap firmware in the factory partition.

Default 'pio run -t upload' will now flash to ota_0 partition instead of factory.
Use 'pio run -t upload_factory' if you intentionally want to update the bootstrap.
"""
import os
import re
import shlex

Import("env")


def is_safe_env_key(key: str) -> bool:
    """Validate environment variable key is safe (alphanumeric + underscore)."""
    return bool(re.match(r"^[A-Za-z_][A-Za-z0-9_]*$", key))


def is_safe_mqtt_broker(broker: str) -> bool:
    """Validate MQTT broker format (hostname or IP)."""
    # Allow hostnames, IPs, and localhost
    return bool(re.match(r"^[a-zA-Z0-9\-._]+$", broker))


def is_safe_port(port: str) -> bool:
    """Validate port is a valid number 1-65535."""
    if not port.isdigit():
        return False
    port_num = int(port)
    return 1 <= port_num <= 65535


def sanitize_for_c_string(value: str) -> str:
    """
    Sanitize value for use in C string literal.
    Escapes backslashes, quotes, and newlines to prevent injection.
    """
    value = value.replace("\\", "\\\\")
    value = value.replace('"', '\\"')
    value = value.replace("\n", "\\n")
    value = value.replace("\r", "\\r")
    return value


def sanitize_path(path: str) -> str:
    """
    Sanitize file path for shell execution.
    Uses shlex.quote for safe quoting.
    """
    return shlex.quote(path)


# ==============================================================================
# Bootstrap Protection: Override default upload address
# ==============================================================================
def _get_ota_app_address(pioenv: str) -> str:
    """Get the OTA partition address for uploads (protects bootstrap).

    Note: Only ESP32-S3 8MB is supported. 4MB ESP32 support has been dropped.
    """
    return "0x260000"  # ota_0 for 8MB flash


def _override_upload_address():
    """Override PlatformIO's default upload address to protect bootstrap.

    By default, PlatformIO uploads to 0x10000 (factory partition) which
    overwrites the bootstrap. This function changes the upload address
    to the ota_0 partition.
    """
    pioenv = env.get("PIOENV", "")

    # Skip for native/test environments
    if "native" in pioenv:
        return

    ota_addr = _get_ota_app_address(pioenv)

    # Get current upload flags and replace the app address
    # ESP32 Arduino uses esptool with format: write_flash 0x10000 firmware.bin
    upload_flags = env.get("UPLOADERFLAGS", [])

    # Replace 0x10000 with OTA address in upload flags
    new_flags = []
    replaced = False
    for i, flag in enumerate(upload_flags):
        if flag == "0x10000":
            new_flags.append(ota_addr)
            replaced = True
            print(f"[BOOTSTRAP PROTECTION] Redirecting upload: 0x10000 -> {ota_addr}")
        else:
            new_flags.append(flag)

    if replaced:
        env.Replace(UPLOADERFLAGS=new_flags)
        print(
            f"[BOOTSTRAP PROTECTION] Upload will target ota_0 partition at {ota_addr}"
        )
        print(
            "[BOOTSTRAP PROTECTION] Use 'pio run -t upload_factory' to update bootstrap"
        )


# Apply the override immediately when script loads
_override_upload_address()


def _ota_params(pioenv: str, use_factory: bool = False) -> dict:
    """Get flash parameters for ESP32-S3 8MB environment.

    Note: 4MB ESP32 support has been dropped. Web assets are now embedded
    in firmware, eliminating the need for separate LittleFS OTA updates.

    Args:
        pioenv: PlatformIO environment name
        use_factory: If True, target factory partition (bootstrap).
                     If False, target ota_0 partition (main firmware).
    """
    # ESP32-S3 8MB only (4MB ESP32 support dropped)
    return {
        "chip": "esp32s3",
        "flash_freq": "80m",
        "flash_size": "8MB",
        # factory=0x10000 (bootstrap), ota_0=0x260000 (main firmware)
        "app_addr": "0x10000" if use_factory else "0x260000",
    }


def _load_dotenv() -> None:
    env_path = os.path.join(env.subst("$PROJECT_DIR"), ".env")
    if not os.path.exists(env_path):
        return

    with open(env_path, "r", encoding="utf-8") as handle:
        for line_num, raw_line in enumerate(handle, 1):
            line = raw_line.strip()
            if not line or line.startswith("#"):
                continue
            if "=" not in line:
                continue
            key, value = line.split("=", 1)
            key = key.strip()
            value = value.strip().strip("'").strip('"')

            # Validate key format
            if not is_safe_env_key(key):
                print(f"[ENV] WARNING: Skipping invalid key on line {line_num}: {key}")
                continue

            if key:
                os.environ.setdefault(key, value)


def _apply_env_defines() -> None:
    if getattr(_apply_env_defines, "_applied", False):
        return
    _apply_env_defines._applied = True
    _load_dotenv()

    client_id = os.environ.get("WEBEX_CLIENT_ID", "").strip()
    client_secret = os.environ.get("WEBEX_CLIENT_SECRET", "").strip()
    mqtt_broker = os.environ.get("MQTT_BROKER", "").strip()
    mqtt_port = os.environ.get("MQTT_PORT", "").strip()
    mqtt_username = os.environ.get("MQTT_USERNAME", "").strip()
    mqtt_password = os.environ.get("MQTT_PASSWORD", "").strip()

    defines = []

    # Validate and sanitize Webex credentials
    if client_id and client_secret:
        safe_client_id = sanitize_for_c_string(client_id)
        safe_client_secret = sanitize_for_c_string(client_secret)
        defines.append(("WEBEX_CLIENT_ID", f'\\"{safe_client_id}\\"'))
        defines.append(("WEBEX_CLIENT_SECRET", f'\\"{safe_client_secret}\\"'))
        print(f"[ENV] Webex credentials loaded: Client ID={client_id[:8]}***")

    # Validate and sanitize MQTT config
    if mqtt_broker:
        if not is_safe_mqtt_broker(mqtt_broker):
            print(f"[ENV] WARNING: Invalid MQTT broker format: {mqtt_broker}")
        else:
            safe_broker = sanitize_for_c_string(mqtt_broker)
            defines.append(("MQTT_BROKER", f'\\"{safe_broker}\\"'))

            if mqtt_port:
                if not is_safe_port(mqtt_port):
                    print(f"[ENV] WARNING: Invalid MQTT port: {mqtt_port}")
                else:
                    defines.append(("MQTT_PORT", mqtt_port))

            if mqtt_username:
                safe_username = sanitize_for_c_string(mqtt_username)
                defines.append(("MQTT_USERNAME", f'\\"{safe_username}\\"'))

            if mqtt_password:
                safe_password = sanitize_for_c_string(mqtt_password)
                defines.append(("MQTT_PASSWORD", f'\\"{safe_password}\\"'))

            print(f"[ENV] MQTT config loaded: Broker={mqtt_broker}")

    if defines:
        env.Append(CPPDEFINES=defines)
        print("[ENV] Build defines injected from .env")
    else:
        print("[ENV] No credentials found in .env file")


# Note: LMWB bundle creation (_merge_ota_bin) has been removed.
# Web assets are now embedded in firmware, eliminating the need for
# bundled firmware + LittleFS OTA updates. OTA now only downloads firmware.bin.


def _upload_to_partition(
    source=None, target=None, env=None, use_factory=False, **kwargs
):
    """Upload firmware to specified partition.

    Note: Web assets are now embedded in firmware, so we only upload firmware.bin.
    LittleFS is only used for dynamic user content and doesn't need to be uploaded.

    Args:
        use_factory: If True, upload to factory partition (DANGEROUS - overwrites bootstrap).
                     If False, upload to ota_0 partition (safe).
    """
    _apply_env_defines()
    if env is None:
        env = kwargs.get("env")
    pioenv = env["PIOENV"]
    build_dir = os.path.join(env.subst("$PROJECT_BUILD_DIR"), pioenv)
    firmware_bin = os.path.join(build_dir, "firmware.bin")

    # Validate firmware binary exists
    if not os.path.exists(firmware_bin):
        print(f"[UPLOAD] ERROR: Firmware binary not found: {firmware_bin}")
        return 1

    params = _ota_params(pioenv, use_factory=use_factory)

    partition_name = "FACTORY (bootstrap)" if use_factory else "OTA_0 (main firmware)"
    print(
        f"[UPLOAD] Uploading firmware to {partition_name} partition at {params['app_addr']}"
    )
    print(
        "[UPLOAD] Web assets are embedded in firmware - no separate LittleFS upload needed"
    )

    if use_factory:
        print("[UPLOAD] WARNING: This will overwrite the bootstrap firmware!")

    port = env.subst("$UPLOAD_PORT")
    speed = env.subst("$UPLOAD_SPEED") or "921600"

    # Sanitize port for shell (may contain /dev/ttyUSB0, COM1, etc.)
    port_arg = f"--port {sanitize_path(port)}" if port else ""

    core_dir = env.subst("$PLATFORMIO_CORE_DIR") or os.path.expanduser("~/.platformio")
    penv_python = os.path.join(core_dir, "penv", "bin", "python")
    python_exe = penv_python if os.path.exists(penv_python) else env.subst("$PYTHONEXE")
    esptool_path = os.path.join(core_dir, "packages", "tool-esptoolpy", "esptool.py")

    # Sanitize all paths for shell execution
    safe_python = sanitize_path(python_exe)
    safe_esptool = sanitize_path(esptool_path)
    safe_firmware_bin = sanitize_path(firmware_bin)

    cmd = (
        f'{safe_python} {safe_esptool} --chip {params["chip"]} {port_arg} '
        f'--baud {speed} write_flash {params["app_addr"]} {safe_firmware_bin}'
    )
    return env.Execute(cmd)


def _upload_ota_bin(source=None, target=None, env=None, **kwargs):
    """Upload to OTA partition (safe - protects bootstrap)."""
    return _upload_to_partition(source, target, env, use_factory=False, **kwargs)


def _upload_factory_bin(source=None, target=None, env=None, **kwargs):
    """Upload to factory partition (DANGEROUS - overwrites bootstrap)."""
    return _upload_to_partition(source, target, env, use_factory=True, **kwargs)


# Note: build_ota_bin target removed - LMWB bundles no longer needed
# Web assets are now embedded in firmware for atomic OTA updates

# Safe upload - targets OTA partition, protects bootstrap
env.AddCustomTarget(
    name="upload_ota",
    dependencies=None,
    actions=[
        "pio run -e $PIOENV",
        _upload_ota_bin,
    ],
    title="Upload to OTA partition (SAFE)",
    description="Uploads firmware to ota_0 partition, protecting bootstrap",
)

# Legacy alias for backwards compatibility
env.AddCustomTarget(
    name="upload_ota_bin",
    dependencies=None,
    actions=[
        "pio run -e $PIOENV",
        _upload_ota_bin,
    ],
    title="Upload firmware (SAFE)",
    description="Uploads firmware to ota_0 partition, protecting bootstrap",
)

# Dangerous upload - targets factory partition (only for bootstrap updates)
env.AddCustomTarget(
    name="upload_factory",
    dependencies=None,
    actions=[
        "pio run -e $PIOENV",
        _upload_factory_bin,
    ],
    title="Upload to FACTORY partition (DANGER)",
    description="WARNING: Overwrites bootstrap! Only use for bootstrap updates.",
)


_apply_env_defines()
env.AddPreAction("buildprog", lambda source, target, env: _apply_env_defines())
env.AddPreAction("buildfs", lambda source, target, env: _apply_env_defines())


# ==============================================================================
# Pre-upload hook to protect bootstrap partition
# ==============================================================================
def _pre_upload_protection(source, target, env):
    """Pre-upload hook that ensures we're targeting the OTA partition.

    This runs just before upload and modifies the esptool command to
    use the OTA partition address instead of the factory address.
    """
    pioenv = env.get("PIOENV", "")

    # Skip for native/test environments
    if "native" in pioenv:
        return

    ota_addr = _get_ota_app_address(pioenv)

    # Check if FLASH_EXTRA_IMAGES or similar needs updating
    # For ESP32 Arduino, the upload command uses UPLOADERFLAGS
    upload_flags = env.get("UPLOADERFLAGS", [])

    new_flags = []
    modified = False

    for flag in upload_flags:
        if flag == "0x10000":
            new_flags.append(ota_addr)
            modified = True
        else:
            new_flags.append(flag)

    if modified:
        env.Replace(UPLOADERFLAGS=new_flags)
        print("")
        print("=" * 70)
        print("[BOOTSTRAP PROTECTION] Upload redirected to OTA partition!")
        print(f"[BOOTSTRAP PROTECTION] Target address: {ota_addr} (ota_0)")
        print("[BOOTSTRAP PROTECTION] Bootstrap at 0x10000 is PROTECTED")
        print("=" * 70)
        print("")


# Register pre-upload hook for default upload target
env.AddPreAction("upload", _pre_upload_protection)
