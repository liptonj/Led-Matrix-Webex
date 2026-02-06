"""
PlatformIO pre-script to add test source files.

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

# Add config manager (split into domain files), nvs utils, and mock globals to the build
src_filter = [
    # Config manager domain files (split from monolithic config_manager.cpp)
    "+<config/config_manager.cpp>",
    "+<config/config_wifi.cpp>",
    "+<config/config_display.cpp>",
    "+<config/config_webex.cpp>",
    "+<config/config_mqtt.cpp>",
    "+<config/config_supabase.cpp>",
    "+<config/config_time.cpp>",
    "+<config/config_export.cpp>",
    # Common utilities
    "+<common/nvs_utils.cpp>",
    # Note: provision_helpers.cpp excluded from global test sources
    # It requires the Dependencies framework with 23 mock manager objects
    # that only test_provision_helpers provides. The test file directly includes
    # the implementation via #include "../../src/sync/provision_helpers.cpp"
    # Note: http_utils.cpp and heap_utils.cpp excluded from native tests
    # as they require ESP32-specific headers (WiFiClientSecure, etc.)
    # Mocks
    "+<../simulation/mocks/globals.cpp>",
]

env.Append(SRC_FILTER=src_filter)  # noqa: F821

print("[TEST] Added config domain files, utilities and mocks to test build")
