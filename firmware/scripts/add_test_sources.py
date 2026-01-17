"""
PlatformIO pre-script to add test source files.

This script is executed by PlatformIO's SCons build system which injects
the 'Import' function and 'env' object at runtime.
"""
# pylint: disable=undefined-variable,used-before-assignment
# pyright: reportUndefinedVariable=false, reportUnboundVariable=false
# mypy: disable-error-code="name-defined"
import os
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from SCons.Script import Environment  # type: ignore[import-not-found]

# Declare SCons globals for type checkers - these are injected by PlatformIO
Import: Any  # noqa: F821
env: "Environment"  # noqa: F821

Import("env")  # noqa: F821

# Get the project directory
project_dir = env.get("PROJECT_DIR", "")  # noqa: F821

# Add config manager and mock globals to the build
env.Append(  # noqa: F821
    SRC_FILTER=[
        "+<config/config_manager.cpp>",
        "+<../simulation/mocks/globals.cpp>",
    ]
)

print("[TEST] Added config_manager.cpp and globals.cpp to test build")
