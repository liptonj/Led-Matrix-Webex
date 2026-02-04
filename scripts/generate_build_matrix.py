#!/usr/bin/env python3
"""
Generate GitHub Actions build matrix from boards.json configuration.
Usage: python3 scripts/generate_build_matrix.py
Output: JSON matrix for GitHub Actions
"""

import json
import sys
from pathlib import Path


def load_boards_config():
    """Load boards configuration from boards.json"""
    config_path = Path(__file__).parent.parent / "boards.json"

    if not config_path.exists():
        print(f"Error: {config_path} not found", file=sys.stderr)
        sys.exit(1)

    with open(config_path, "r") as f:
        config = json.load(f)

    return config


def generate_matrix(config):
    """Generate GitHub Actions matrix from config"""
    boards = config.get("boards", [])

    if not boards:
        print("Error: No boards defined in configuration", file=sys.stderr)
        sys.exit(1)

    matrix = {"include": []}

    for board in boards:
        matrix["include"].append(
            {
                "board_type": board["board_type"],
                "chip_family": board["chip_family"],
                "platformio_env": board["platformio_env"],
                "flash_size": board["flash_size"],
                "description": board["description"],
            }
        )

    return matrix


def main():
    """Main entry point"""
    config = load_boards_config()
    matrix = generate_matrix(config)

    # Output JSON for GitHub Actions
    print(json.dumps(matrix))


if __name__ == "__main__":
    main()
