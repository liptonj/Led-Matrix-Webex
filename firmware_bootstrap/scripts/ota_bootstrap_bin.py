# mypy: ignore-errors
"""
Bootstrap Firmware Build Scripts for ESP32-S3.

Note: Web assets are now embedded in firmware, so LittleFS is not
included in the full-flash binary or OTA updates. The merged binary
includes only bootloader, partitions, and firmware.

4MB ESP32 support has been dropped.
"""
import os

Import("env")


def _flash_params() -> dict:
    """Get flash parameters for ESP32-S3 8MB."""
    return {
        "chip": "esp32s3",
        "flash_freq": "80m",
        "flash_size": "8MB",
        "app_addr": "0x10000",
    }


def _merge_bootstrap_bin(source, target, env):
    """Create merged binary for full-flash (bootloader + partitions + firmware).
    
    Note: LittleFS not included - web assets are now embedded in firmware.
    """
    pioenv = env["PIOENV"]
    build_dir = os.path.join(env.subst("$PROJECT_BUILD_DIR"), pioenv)
    firmware_bin = os.path.join(build_dir, "firmware.bin")
    bootloader_bin = os.path.join(build_dir, "bootloader.bin")
    partitions_bin = os.path.join(build_dir, "partitions.bin")
    merged_bin = os.path.join(build_dir, f"bootstrap-full-{pioenv}.bin")

    params = _flash_params()

    core_dir = env.subst("$PLATFORMIO_CORE_DIR") or os.path.expanduser("~/.platformio")
    penv_python = os.path.join(core_dir, "penv", "bin", "python")
    python_exe = penv_python if os.path.exists(penv_python) else env.subst("$PYTHONEXE")
    boot_app0 = os.path.join(
        core_dir,
        "packages",
        "framework-arduinoespressif32",
        "tools",
        "partitions",
        "boot_app0.bin",
    )
    esptool_path = os.path.join(core_dir, "packages", "tool-esptoolpy", "esptool.py")

    required_files = [firmware_bin, bootloader_bin, partitions_bin, boot_app0]
    if not all(os.path.exists(path) for path in required_files):
        print("Skipping merged bootstrap binary: required files not found.")
        return 1

    # Merge without LittleFS - web assets are now embedded in firmware
    cmd = (
        f'"{python_exe}" "{esptool_path}" --chip {params["chip"]} merge_bin '
        f'-o "{merged_bin}" --flash_mode dio --flash_freq {params["flash_freq"]} '
        f'--flash_size {params["flash_size"]} 0x0 "{bootloader_bin}" '
        f'0x8000 "{partitions_bin}" 0xE000 "{boot_app0}" '
        f'{params["app_addr"]} "{firmware_bin}"'
    )
    return env.Execute(cmd)


def _upload_bootstrap_bin(source, target, env):
    """Upload bootstrap to device (bootloader + partitions + firmware).
    
    Note: LittleFS not included - web assets are now embedded in firmware.
    """
    pioenv = env["PIOENV"]
    build_dir = os.path.join(env.subst("$PROJECT_BUILD_DIR"), pioenv)
    params = _flash_params()
    firmware_bin = os.path.join(build_dir, "firmware.bin")
    bootloader_bin = os.path.join(build_dir, "bootloader.bin")
    partitions_bin = os.path.join(build_dir, "partitions.bin")

    port = env.subst("$UPLOAD_PORT")
    speed = env.subst("$UPLOAD_SPEED") or "921600"
    port_arg = f'--port "{port}"' if port else ""

    core_dir = env.subst("$PLATFORMIO_CORE_DIR") or os.path.expanduser("~/.platformio")
    penv_python = os.path.join(core_dir, "penv", "bin", "python")
    python_exe = penv_python if os.path.exists(penv_python) else env.subst("$PYTHONEXE")
    esptool_path = os.path.join(core_dir, "packages", "tool-esptoolpy", "esptool.py")
    boot_app0 = os.path.join(
        core_dir,
        "packages",
        "framework-arduinoespressif32",
        "tools",
        "partitions",
        "boot_app0.bin",
    )
    
    required_files = [firmware_bin, bootloader_bin, partitions_bin, boot_app0]
    if not all(os.path.exists(path) for path in required_files):
        print("Skipping bootstrap upload: required files not found.")
        return 1
    
    # Upload without LittleFS - web assets are now embedded in firmware
    cmd = (
        f'"{python_exe}" "{esptool_path}" --chip {params["chip"]} {port_arg} '
        f'--baud {speed} --before default_reset --after hard_reset write_flash '
        f'0x0 "{bootloader_bin}" '
        f'0x8000 "{partitions_bin}" '
        f'0xE000 "{boot_app0}" '
        f'{params["app_addr"]} "{firmware_bin}"'
    )
    return env.Execute(cmd)


env.AddCustomTarget(
    name="build_bootstrap_bin",
    dependencies=None,
    actions=[
        "pio run -e $PIOENV",
        _merge_bootstrap_bin,
    ],
    title="Build bootstrap full-flash bin",
    description="Builds a single bin with bootloader + partitions + firmware (web assets embedded)",
)

env.AddCustomTarget(
    name="upload_bootstrap_bin",
    dependencies=None,
    actions=[
        "pio run -e $PIOENV",
        _merge_bootstrap_bin,
        _upload_bootstrap_bin,
    ],
    title="Upload bootstrap full-flash bin",
    description="Builds and uploads bootstrap (web assets embedded in firmware)",
)

# Note: build_bootstrap_ota_bin target removed - LMWB bundles no longer needed
# Web assets are now embedded in firmware for atomic OTA updates
