# mypy: ignore-errors
"""
OTA and Upload Scripts for ESP32 Firmware with Bootstrap Protection.

IMPORTANT: This script overrides PlatformIO's default upload behavior to 
protect the bootstrap firmware in the factory partition.

Default 'pio run -t upload' will now flash to ota_0 partition instead of factory.
Use 'pio run -t upload_factory' if you intentionally want to update the bootstrap.
"""
import os
import struct

Import("env")


# ==============================================================================
# Bootstrap Protection: Override default upload address
# ==============================================================================
def _get_ota_app_address(pioenv: str) -> str:
    """Get the OTA partition address for uploads (protects bootstrap)."""
    if "esp32s3" in pioenv:
        return "0x260000"  # ota_0 for 8MB flash
    return "0x150000"  # ota_0 for 4MB flash


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
        print(f"[BOOTSTRAP PROTECTION] Upload will target ota_0 partition at {ota_addr}")
        print("[BOOTSTRAP PROTECTION] Use 'pio run -t upload_factory' to update bootstrap")


# Apply the override immediately when script loads
_override_upload_address()


def _ota_params(pioenv: str, use_factory: bool = False) -> dict:
    """Get flash parameters for the given environment.
    
    Args:
        pioenv: PlatformIO environment name
        use_factory: If True, target factory partition (bootstrap).
                     If False, target ota_0 partition (main firmware).
    """
    if "esp32s3" in pioenv:
        return {
            "chip": "esp32s3",
            "flash_freq": "80m",
            "flash_size": "8MB",
            # factory=0x10000 (bootstrap), ota_0=0x260000 (main firmware)
            "app_addr": "0x10000" if use_factory else "0x260000",
            "fs_addr": "0x700000",
        }
    return {
        "chip": "esp32",
        "flash_freq": "40m",
        "flash_size": "4MB",
        # factory=0x10000 (bootstrap), ota_0=0x150000 (main firmware)
        "app_addr": "0x10000" if use_factory else "0x150000",
        "fs_addr": "0x3D0000",
    }


def _load_dotenv() -> None:
    env_path = os.path.join(env.subst("$PROJECT_DIR"), ".env")
    if not os.path.exists(env_path):
        return

    with open(env_path, "r", encoding="utf-8") as handle:
        for raw_line in handle:
            line = raw_line.strip()
            if not line or line.startswith("#"):
                continue
            if "=" not in line:
                continue
            key, value = line.split("=", 1)
            key = key.strip()
            value = value.strip().strip("'").strip('"')
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
    if client_id and client_secret:
        defines.append(("WEBEX_CLIENT_ID", f'\\"{client_id}\\"'))
        defines.append(("WEBEX_CLIENT_SECRET", f'\\"{client_secret}\\"'))
        print(f"[ENV] Webex credentials loaded: Client ID={client_id[:8]}***")

    if mqtt_broker:
        defines.append(("MQTT_BROKER", f'\\"{mqtt_broker}\\"'))
        if mqtt_port.isdigit():
            defines.append(("MQTT_PORT", mqtt_port))
        if mqtt_username:
            defines.append(("MQTT_USERNAME", f'\\"{mqtt_username}\\"'))
        if mqtt_password:
            defines.append(("MQTT_PASSWORD", f'\\"{mqtt_password}\\"'))
        print(f"[ENV] MQTT config loaded: Broker={mqtt_broker}")

    if defines:
        env.Append(CPPDEFINES=defines)
        print("[ENV] Build defines injected from .env")
    else:
        print("[ENV] No credentials found in .env file")


def _merge_ota_bin(_source=None, _target=None, env=None, **_kwargs):
    _apply_env_defines()
    if env is None:
        env = _kwargs.get("env")
    if env is None:
        print("Skipping OTA bundle: build environment not available.")
        return 1
    pioenv = env["PIOENV"]
    build_dir = os.path.join(env.subst("$PROJECT_BUILD_DIR"), pioenv)
    firmware_bin = os.path.join(build_dir, "firmware.bin")
    littlefs_bin = os.path.join(build_dir, "littlefs.bin")
    ota_bin = os.path.join(build_dir, f"firmware-ota-{pioenv}.bin")
    if not os.path.exists(firmware_bin) or not os.path.exists(littlefs_bin):
        print("Skipping OTA bundle: firmware or LittleFS bin missing.")
        return 1

    app_size = os.path.getsize(firmware_bin)
    fs_size = os.path.getsize(littlefs_bin)

    with open(ota_bin, "wb") as output:
        output.write(b"LMWB")
        output.write(struct.pack("<III", app_size, fs_size, 0))
        with open(firmware_bin, "rb") as firmware:
            output.write(firmware.read())
        with open(littlefs_bin, "rb") as littlefs:
            output.write(littlefs.read())

    print(f"Created OTA bundle: {ota_bin} (app={app_size} bytes, fs={fs_size} bytes)")
    return 0


def _upload_to_partition(source=None, target=None, env=None, use_factory=False, **kwargs):
    """Upload firmware to specified partition.
    
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
    littlefs_bin = os.path.join(build_dir, "littlefs.bin")
    params = _ota_params(pioenv, use_factory=use_factory)

    partition_name = "FACTORY (bootstrap)" if use_factory else "OTA_0 (main firmware)"
    print(f"[UPLOAD] Uploading to {partition_name} partition at {params['app_addr']}")
    
    if use_factory:
        print("[UPLOAD] WARNING: This will overwrite the bootstrap firmware!")

    port = env.subst("$UPLOAD_PORT")
    speed = env.subst("$UPLOAD_SPEED") or "921600"
    port_arg = f'--port "{port}"' if port else ""

    core_dir = env.subst("$PLATFORMIO_CORE_DIR") or os.path.expanduser("~/.platformio")
    penv_python = os.path.join(core_dir, "penv", "bin", "python")
    python_exe = penv_python if os.path.exists(penv_python) else env.subst("$PYTHONEXE")
    esptool_path = os.path.join(core_dir, "packages", "tool-esptoolpy", "esptool.py")
    cmd = (
        f'"{python_exe}" "{esptool_path}" --chip {params["chip"]} {port_arg} '
        f'--baud {speed} write_flash {params["app_addr"]} "{firmware_bin}" '
        f'{params["fs_addr"]} "{littlefs_bin}"'
    )
    return env.Execute(cmd)


def _upload_ota_bin(source=None, target=None, env=None, **kwargs):
    """Upload to OTA partition (safe - protects bootstrap)."""
    return _upload_to_partition(source, target, env, use_factory=False, **kwargs)


def _upload_factory_bin(source=None, target=None, env=None, **kwargs):
    """Upload to factory partition (DANGEROUS - overwrites bootstrap)."""
    return _upload_to_partition(source, target, env, use_factory=True, **kwargs)


env.AddCustomTarget(
    name="build_ota_bin",
    dependencies=None,
    actions=[
        "pio run -e $PIOENV",
        "pio run -e $PIOENV -t buildfs",
        _merge_ota_bin,
    ],
    title="Build merged OTA bin",
    description="Builds a single bin with app + LittleFS (no bootloader)",
)

# Safe upload - targets OTA partition, protects bootstrap
env.AddCustomTarget(
    name="upload_ota",
    dependencies=None,
    actions=[
        "pio run -e $PIOENV",
        "pio run -e $PIOENV -t buildfs",
        _upload_ota_bin,
    ],
    title="Upload to OTA partition (SAFE)",
    description="Uploads firmware + LittleFS to ota_0 partition, protecting bootstrap",
)

# Legacy alias for backwards compatibility
env.AddCustomTarget(
    name="upload_ota_bin",
    dependencies=None,
    actions=[
        "pio run -e $PIOENV",
        "pio run -e $PIOENV -t buildfs",
        _merge_ota_bin,
        _upload_ota_bin,
    ],
    title="Upload merged OTA bin (SAFE)",
    description="Builds bundle and uploads to ota_0 partition, protecting bootstrap",
)

# Dangerous upload - targets factory partition (only for bootstrap updates)
env.AddCustomTarget(
    name="upload_factory",
    dependencies=None,
    actions=[
        "pio run -e $PIOENV",
        "pio run -e $PIOENV -t buildfs",
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
