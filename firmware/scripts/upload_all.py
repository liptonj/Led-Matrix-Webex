# mypy: ignore-errors
Import("env")

env.AddCustomTarget(
    name="upload_all",
    dependencies=None,
    actions=[
        "pio run -e $PIOENV -t upload",
        "pio run -e $PIOENV -t uploadfs",
    ],
    title="Upload Firmware and LittleFS",
    description="Uploads firmware and filesystem in one step",
)
