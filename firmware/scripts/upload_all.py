# mypy: ignore-errors
"""
Upload scripts for ESP32 firmware with bootstrap protection.

IMPORTANT: The default 'upload' and 'uploadfs' targets in PlatformIO 
flash to the FACTORY partition (0x10000), which overwrites the bootstrap!

Use these custom targets instead:
- upload_all:     Safe upload to OTA partition (protects bootstrap)
- upload_ota:     Same as upload_all
- upload_factory: DANGER - Overwrites bootstrap (only for bootstrap updates)
"""
Import("env")


def _get_ota_address(pioenv: str) -> str:
    """Get the OTA partition address for the environment."""
    if "esp32s3" in pioenv:
        return "0x260000"  # ota_0 for 8MB flash
    return "0x150000"  # ota_0 for 4MB flash


def _upload_firmware_to_ota(source, target, env):
    """Upload firmware.bin to OTA partition instead of factory."""
    import os
    
    pioenv = env["PIOENV"]
    build_dir = os.path.join(env.subst("$PROJECT_BUILD_DIR"), pioenv)
    firmware_bin = os.path.join(build_dir, "firmware.bin")
    ota_addr = _get_ota_address(pioenv)
    
    chip = "esp32s3" if "esp32s3" in pioenv else "esp32"
    port = env.subst("$UPLOAD_PORT")
    speed = env.subst("$UPLOAD_SPEED") or "921600"
    port_arg = f'--port "{port}"' if port else ""
    
    core_dir = env.subst("$PLATFORMIO_CORE_DIR") or os.path.expanduser("~/.platformio")
    penv_python = os.path.join(core_dir, "penv", "bin", "python")
    python_exe = penv_python if os.path.exists(penv_python) else env.subst("$PYTHONEXE")
    esptool_path = os.path.join(core_dir, "packages", "tool-esptoolpy", "esptool.py")
    
    print(f"[UPLOAD] Uploading firmware to OTA partition at {ota_addr} (protecting bootstrap)")
    
    cmd = (
        f'"{python_exe}" "{esptool_path}" --chip {chip} {port_arg} '
        f'--baud {speed} write_flash {ota_addr} "{firmware_bin}"'
    )
    return env.Execute(cmd)


# Safe upload - uses OTA partition, protects bootstrap
env.AddCustomTarget(
    name="upload_all",
    dependencies=None,
    actions=[
        "pio run -e $PIOENV",
        "pio run -e $PIOENV -t buildfs",
        _upload_firmware_to_ota,
        "pio run -e $PIOENV -t uploadfs",
    ],
    title="Upload Firmware and LittleFS (SAFE)",
    description="Uploads to OTA partition - protects bootstrap firmware",
)
