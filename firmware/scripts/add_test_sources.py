"""
PlatformIO pre-script to add test source files.

This script is executed by PlatformIO's SCons build system which injects
the 'Import' function and 'env' object at runtime.
"""
# pylint: disable=undefined-variable,used-before-assignment
# pyright: reportUndefinedVariable=false, reportUnboundVariable=false
# mypy: disable-error-code="name-defined"
from typing import TYPE_CHECKING, Any
import os

if TYPE_CHECKING:
    from SCons.Script import Environment  # type: ignore[import-not-found]

# Declare SCons globals for type checkers - these are injected by PlatformIO
Import: Any  # noqa: F821
env: "Environment"  # noqa: F821

Import("env")  # noqa: F821

# Try to detect which test is being built by checking environment variables
# PlatformIO may set PIO_TEST_NAME or we can check the current working directory
test_name = os.environ.get("PIO_TEST_NAME", "")
if not test_name:
    # Try to infer from test source files being compiled
    # This is a fallback - PlatformIO doesn't always expose test name easily
    cwd = os.getcwd()
    if "test_serial_commands" in cwd:
        test_name = "test_serial_commands"

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
    # Serial commands - include for all tests that need it
    # The mocks in globals.cpp use weak linkage, so they'll only be used
    # if serial_commands.cpp is not linked. This allows both approaches to work.
    "+<serial/serial_commands.cpp>",
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

# Note: We do NOT define SERIAL_COMMANDS_INCLUDED globally anymore.
# Instead, the mocks in globals.cpp use weak linkage (__attribute__((weak)))
# so they're only used if serial_commands.cpp is not linked. If serial_commands.cpp
# is linked, its symbols will take precedence over the weak mocks.
# This allows tests that include serial_commands.cpp to use the real implementation,
# while tests that don't include it will use the weak mocks.

print("[TEST] Added config domain files, utilities and mocks to test build")
