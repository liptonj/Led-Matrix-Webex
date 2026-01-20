"""
PlatformIO pre-build script to inject version information.

This script is executed by PlatformIO's SCons build system which injects
the 'Import' function and 'env' object at runtime.
"""
# pylint: disable=undefined-variable,used-before-assignment
# pyright: reportUndefinedVariable=false, reportUnboundVariable=false
# mypy: disable-error-code="name-defined"
import subprocess
import time
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from SCons.Script import Environment  # type: ignore[import-not-found]

# Declare SCons globals for type checkers - these are injected by PlatformIO
Import: Any  # noqa: F821
env: "Environment"  # noqa: F821

Import("env")  # noqa: F821


def get_git_version() -> str:
    """Get version from git tags or use default."""
    try:
        git_version = subprocess.check_output(
            ["git", "describe", "--tags", "--always"],
            stderr=subprocess.DEVNULL,
        ).decode().strip()
        return git_version
    except (subprocess.CalledProcessError, FileNotFoundError, OSError):
        return "1.0.0-dev"


def get_git_commit() -> str:
    """Get current git commit hash."""
    try:
        git_commit = subprocess.check_output(
            ["git", "rev-parse", "--short", "HEAD"],
            stderr=subprocess.DEVNULL,
        ).decode().strip()
        return git_commit
    except (subprocess.CalledProcessError, FileNotFoundError, OSError):
        return "unknown"


def get_build_id() -> str:
    """Get a build ID based on epoch seconds."""
    try:
        return str(int(time.time()))
    except (OSError, ValueError):
        return "unknown"


def main() -> None:
    """Inject version build flags into PlatformIO environment."""
    build_version = get_git_version()
    build_commit = get_git_commit()
    build_id = get_build_id()

    env.Append(  # noqa: F821
        CPPDEFINES=[
            ("BUILD_VERSION", f'\\"{build_version}\\"'),
            ("BUILD_COMMIT", f'\\"{build_commit}\\"'),
            ("BUILD_ID", f'\\"{build_id}\\"'),
        ]
    )

    print(f"Build version: {build_version} ({build_commit}) [{build_id}]")


main()
