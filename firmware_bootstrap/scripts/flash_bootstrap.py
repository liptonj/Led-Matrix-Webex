# mypy: ignore-errors
"""
Flash Bootstrap Firmware to Factory Partition

This script flashes the bootstrap firmware to the factory partition (0x10000).
Use this to:
- Initially provision a new device
- Recover a device where bootstrap was accidentally overwritten

Usage:
    cd firmware_bootstrap
    pio run -e esp32s3 -t flash_bootstrap

WARNING: This overwrites the factory partition at 0x10000!
"""
import os

Import("env")


def _get_flash_params(pioenv: str) -> dict:
    """Get flash parameters for the environment."""
    if "esp32s3" in pioenv:
        return {
            "chip": "esp32s3",
            "flash_freq": "80m",
            "flash_size": "8MB",
            "factory_addr": "0x10000",
            "fs_addr": "0x700000",
        }
    return {
        "chip": "esp32",
        "flash_freq": "40m",
        "flash_size": "4MB",
        "factory_addr": "0x10000",
        "fs_addr": "0x3D0000",
    }


def _flash_bootstrap(source, target, env):
    """Flash bootstrap firmware to factory partition."""
    pioenv = env["PIOENV"]
    build_dir = os.path.join(env.subst("$PROJECT_BUILD_DIR"), pioenv)
    firmware_bin = os.path.join(build_dir, "firmware.bin")
    params = _get_flash_params(pioenv)

    if not os.path.exists(firmware_bin):
        print("[BOOTSTRAP] Error: firmware.bin not found. Run 'pio run' first.")
        return 1

    print("")
    print("=" * 70)
    print("[BOOTSTRAP] Flashing bootstrap to FACTORY partition")
    print(f"[BOOTSTRAP] Target: {params['factory_addr']} (factory)")
    print(f"[BOOTSTRAP] Firmware: {firmware_bin}")
    print("=" * 70)
    print("")

    port = env.subst("$UPLOAD_PORT")
    speed = env.subst("$UPLOAD_SPEED") or "921600"
    port_arg = f'--port "{port}"' if port else ""

    core_dir = env.subst("$PLATFORMIO_CORE_DIR") or os.path.expanduser("~/.platformio")
    penv_python = os.path.join(core_dir, "penv", "bin", "python")
    python_exe = penv_python if os.path.exists(penv_python) else env.subst("$PYTHONEXE")
    esptool_path = os.path.join(core_dir, "packages", "tool-esptoolpy", "esptool.py")

    cmd = (
        f'"{python_exe}" "{esptool_path}" --chip {params["chip"]} {port_arg} '
        f'--baud {speed} write_flash {params["factory_addr"]} "{firmware_bin}"'
    )
    return env.Execute(cmd)


def _flash_bootstrap_with_fs(source, target, env):
    """Flash bootstrap firmware and LittleFS to factory partition."""
    pioenv = env["PIOENV"]
    build_dir = os.path.join(env.subst("$PROJECT_BUILD_DIR"), pioenv)
    firmware_bin = os.path.join(build_dir, "firmware.bin")
    littlefs_bin = os.path.join(build_dir, "littlefs.bin")
    params = _get_flash_params(pioenv)

    if not os.path.exists(firmware_bin):
        print("[BOOTSTRAP] Error: firmware.bin not found. Run 'pio run' first.")
        return 1
    if not os.path.exists(littlefs_bin):
        print("[BOOTSTRAP] Error: littlefs.bin not found. Run 'pio run -t buildfs' first.")
        return 1

    print("")
    print("=" * 70)
    print("[BOOTSTRAP] Flashing bootstrap + LittleFS to FACTORY partition")
    print(f"[BOOTSTRAP] Firmware target: {params['factory_addr']} (factory)")
    print(f"[BOOTSTRAP] LittleFS target: {params['fs_addr']} (spiffs)")
    print("=" * 70)
    print("")

    port = env.subst("$UPLOAD_PORT")
    speed = env.subst("$UPLOAD_SPEED") or "921600"
    port_arg = f'--port "{port}"' if port else ""

    core_dir = env.subst("$PLATFORMIO_CORE_DIR") or os.path.expanduser("~/.platformio")
    penv_python = os.path.join(core_dir, "penv", "bin", "python")
    python_exe = penv_python if os.path.exists(penv_python) else env.subst("$PYTHONEXE")
    esptool_path = os.path.join(core_dir, "packages", "tool-esptoolpy", "esptool.py")

    cmd = (
        f'"{python_exe}" "{esptool_path}" --chip {params["chip"]} {port_arg} '
        f'--baud {speed} write_flash '
        f'{params["factory_addr"]} "{firmware_bin}" '
        f'{params["fs_addr"]} "{littlefs_bin}"'
    )
    return env.Execute(cmd)


# Register custom targets
env.AddCustomTarget(
    name="flash_bootstrap",
    dependencies=None,
    actions=[
        "pio run -e $PIOENV",
        _flash_bootstrap,
    ],
    title="Flash Bootstrap to Factory",
    description="Builds and flashes bootstrap firmware to factory partition (0x10000)",
)

env.AddCustomTarget(
    name="flash_bootstrap_all",
    dependencies=None,
    actions=[
        "pio run -e $PIOENV",
        "pio run -e $PIOENV -t buildfs",
        _flash_bootstrap_with_fs,
    ],
    title="Flash Bootstrap + LittleFS",
    description="Builds and flashes bootstrap firmware + LittleFS to factory partition",
)
