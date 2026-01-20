# mypy: ignore-errors
import os
import struct

Import("env")


def _ota_params(pioenv: str) -> dict:
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


def _ensure_secrets_header() -> None:
    _load_dotenv()
    include_dir = os.path.join(env.subst("$PROJECT_DIR"), "include")
    secrets_path = os.path.join(include_dir, "secrets.h")
    if os.path.exists(secrets_path):
        return

    client_id = os.environ.get("WEBEX_CLIENT_ID")
    client_secret = os.environ.get("WEBEX_CLIENT_SECRET")
    if not client_id and not client_secret:
        return

    os.makedirs(include_dir, exist_ok=True)
    with open(secrets_path, "w", encoding="utf-8") as handle:
        handle.write("#ifndef SECRETS_H\n#define SECRETS_H\n")
        if client_id:
            handle.write(f'\n#define WEBEX_CLIENT_ID "{client_id}"\n')
        if client_secret:
            handle.write(f'\n#define WEBEX_CLIENT_SECRET "{client_secret}"\n')
        handle.write("\n#endif\n")


def _merge_ota_bin(source, target, env):
    _ensure_secrets_header()
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


def _upload_ota_bin(source, target, env):
    _ensure_secrets_header()
    pioenv = env["PIOENV"]
    build_dir = os.path.join(env.subst("$PROJECT_BUILD_DIR"), pioenv)
    firmware_bin = os.path.join(build_dir, "firmware.bin")
    littlefs_bin = os.path.join(build_dir, "littlefs.bin")
    params = _ota_params(pioenv)

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

env.AddCustomTarget(
    name="upload_ota_bin",
    dependencies=None,
    actions=[
        "pio run -e $PIOENV",
        "pio run -e $PIOENV -t buildfs",
        _merge_ota_bin,
        _upload_ota_bin,
    ],
    title="Upload merged OTA bin",
    description="Builds and uploads app + LittleFS (no bootloader)",
)


env.AddPreAction("buildprog", lambda source, target, env: _ensure_secrets_header())
env.AddPreAction("buildfs", lambda source, target, env: _ensure_secrets_header())
