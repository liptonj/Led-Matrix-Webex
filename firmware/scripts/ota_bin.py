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


def _upload_ota_bin(_source, _target, env):
    _apply_env_defines()
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


_apply_env_defines()
env.AddPreAction("buildprog", lambda source, target, env: _apply_env_defines())
env.AddPreAction("buildfs", lambda source, target, env: _apply_env_defines())
