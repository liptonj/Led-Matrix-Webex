# mypy: ignore-errors
import os

Import("env")


def _flash_params(pioenv: str) -> dict:
    if "esp32s3" in pioenv:
        return {
            "chip": "esp32s3",
            "flash_freq": "80m",
            "flash_size": "8MB",
            "app_addr": "0x10000",
            "fs_addr": "0x700000",
        }
    return {
        "chip": "esp32",
        "flash_freq": "40m",
        "flash_size": "4MB",
        "app_addr": "0x10000",
        "fs_addr": "0x3D0000",
    }


def _merge_bootstrap_bin(source, target, env):
    pioenv = env["PIOENV"]
    build_dir = os.path.join(env.subst("$PROJECT_BUILD_DIR"), pioenv)
    firmware_bin = os.path.join(build_dir, "firmware.bin")
    littlefs_bin = os.path.join(build_dir, "littlefs.bin")
    bootloader_bin = os.path.join(build_dir, "bootloader.bin")
    partitions_bin = os.path.join(build_dir, "partitions.bin")
    merged_bin = os.path.join(build_dir, f"bootstrap-full-{pioenv}.bin")

    params = _flash_params(pioenv)

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

    if not all(
        os.path.exists(path)
        for path in [firmware_bin, littlefs_bin, bootloader_bin, partitions_bin, boot_app0]
    ):
        print("Skipping merged bootstrap binary: required files not found.")
        return 1

    cmd = (
        f'"{python_exe}" "{esptool_path}" --chip {params["chip"]} merge_bin '
        f'-o "{merged_bin}" --flash_mode dio --flash_freq {params["flash_freq"]} '
        f'--flash_size {params["flash_size"]} 0x0 "{bootloader_bin}" '
        f'0x8000 "{partitions_bin}" 0xE000 "{boot_app0}" '
        f'{params["app_addr"]} "{firmware_bin}" {params["fs_addr"]} "{littlefs_bin}"'
    )
    return env.Execute(cmd)


def _upload_bootstrap_bin(source, target, env):
    pioenv = env["PIOENV"]
    build_dir = os.path.join(env.subst("$PROJECT_BUILD_DIR"), pioenv)
    params = _flash_params(pioenv)
    firmware_bin = os.path.join(build_dir, "firmware.bin")
    littlefs_bin = os.path.join(build_dir, "littlefs.bin")
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
    if not all(
        os.path.exists(path)
        for path in [firmware_bin, littlefs_bin, bootloader_bin, partitions_bin, boot_app0]
    ):
        print("Skipping bootstrap upload: required files not found.")
        return 1
    cmd = (
        f'"{python_exe}" "{esptool_path}" --chip {params["chip"]} {port_arg} '
        f'--baud {speed} write_flash '
        f'0x0 "{bootloader_bin}" '
        f'0x8000 "{partitions_bin}" '
        f'0xE000 "{boot_app0}" '
        f'{params["app_addr"]} "{firmware_bin}" '
        f'{params["fs_addr"]} "{littlefs_bin}"'
    )
    return env.Execute(cmd)


env.AddCustomTarget(
    name="build_bootstrap_bin",
    dependencies=None,
    actions=[
        "pio run -e $PIOENV",
        "pio run -e $PIOENV -t buildfs",
        _merge_bootstrap_bin,
    ],
    title="Build bootstrap full-flash bin",
    description="Builds a single bin with bootloader + partitions + app + LittleFS",
)

env.AddCustomTarget(
    name="upload_bootstrap_bin",
    dependencies=None,
    actions=[
        "pio run -e $PIOENV",
        "pio run -e $PIOENV -t buildfs",
        _merge_bootstrap_bin,
        _upload_bootstrap_bin,
    ],
    title="Upload bootstrap full-flash bin",
    description="Builds and uploads a single full-flash bootstrap bin",
)
