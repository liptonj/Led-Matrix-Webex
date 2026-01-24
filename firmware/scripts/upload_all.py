# mypy: ignore-errors
"""
Upload scripts for ESP32-S3 firmware with bootstrap protection.

IMPORTANT: The default 'upload' target in PlatformIO flashes to the 
FACTORY partition (0x10000), which overwrites the bootstrap!

Use these custom targets instead:
- upload_all:     Safe upload to OTA partition (protects bootstrap)
- upload_ota:     Same as upload_all
- upload_factory: DANGER - Overwrites bootstrap (only for bootstrap updates)

Note: Web assets are now embedded in firmware. LittleFS is only used for
dynamic user content and doesn't need to be uploaded during development.
"""
Import("env")


def _get_ota_address(pioenv: str) -> str:
    """Get the OTA partition address for ESP32-S3 8MB."""
    # 4MB ESP32 support dropped - only ESP32-S3 8MB supported
    return "0x260000"  # ota_0 for 8MB flash


def _upload_firmware_to_ota(source, target, env):
    """Upload firmware.bin to OTA partition instead of factory.
    
    Note: LittleFS upload removed - web assets are now embedded in firmware.
    """
    import os
    
    pioenv = env["PIOENV"]
    build_dir = os.path.join(env.subst("$PROJECT_BUILD_DIR"), pioenv)
    firmware_bin = os.path.join(build_dir, "firmware.bin")
    ota_addr = _get_ota_address(pioenv)
    
    port = env.subst("$UPLOAD_PORT")
    speed = env.subst("$UPLOAD_SPEED") or "921600"
    port_arg = f'--port "{port}"' if port else ""
    
    core_dir = env.subst("$PLATFORMIO_CORE_DIR") or os.path.expanduser("~/.platformio")
    penv_python = os.path.join(core_dir, "penv", "bin", "python")
    python_exe = penv_python if os.path.exists(penv_python) else env.subst("$PYTHONEXE")
    esptool_path = os.path.join(core_dir, "packages", "tool-esptoolpy", "esptool.py")
    
    print(f"[UPLOAD] Uploading firmware to OTA partition at {ota_addr} (protecting bootstrap)")
    print("[UPLOAD] Web assets embedded in firmware - no separate LittleFS upload needed")
    
    cmd = (
        f'"{python_exe}" "{esptool_path}" --chip esp32s3 {port_arg} '
        f'--baud {speed} write_flash {ota_addr} "{firmware_bin}"'
    )
    return env.Execute(cmd)


# Safe upload - uses OTA partition, protects bootstrap
env.AddCustomTarget(
    name="upload_all",
    dependencies=None,
    actions=[
        "pio run -e $PIOENV",
        _upload_firmware_to_ota,
    ],
    title="Upload Firmware (SAFE)",
    description="Uploads firmware to OTA partition - web assets embedded, bootstrap protected",
)
