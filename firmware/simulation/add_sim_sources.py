"""
PlatformIO pre-script to add simulation source files.

This script is executed by PlatformIO's SCons build system which injects
the 'Import' function and 'env' object at runtime.
"""
# pylint: disable=undefined-variable,used-before-assignment
# pyright: reportUndefinedVariable=false, reportUnboundVariable=false
# mypy: disable-error-code="name-defined"
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from SCons.Script import Environment  # type: ignore[import-not-found]

# Declare SCons globals for type checkers - these are injected by PlatformIO
Import: Any  # noqa: F821
env: "Environment"  # noqa: F821

Import("env")  # noqa: F821

# Add simulation main, common utilities, and globals to the build
env.Append(  # noqa: F821
    SRC_FILTER=[
        "+<../simulation/main_sim.cpp>",
        # Common utilities needed for tests
        "+<common/nvs_utils.cpp>",
        # Config domain files
        "+<config/config_manager.cpp>",
        "+<config/config_wifi.cpp>",
        "+<config/config_display.cpp>",
        "+<config/config_webex.cpp>",
        "+<config/config_mqtt.cpp>",
        "+<config/config_supabase.cpp>",
        "+<config/config_time.cpp>",
        "+<config/config_export.cpp>",
    ]
)

print("[SIM] Added simulation sources, utilities and config to build")
