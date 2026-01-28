#!/usr/bin/env python3
"""
Update version numbers across the project based on Git tag.

This script updates version numbers in:
- firmware/platformio.ini (firmware_version)
- website/package.json (version)
- bridge/package.json (version)
- README.md (Current Version)

Usage:
    python scripts/update_version.py <version>
    python scripts/update_version.py 1.5.0

Or extract from Git tag:
    python scripts/update_version.py $(git describe --tags --abbrev=0 | sed 's/^v//')
"""

import re
import sys
import json
from pathlib import Path
from typing import Optional


def update_platformio_version(version: str) -> bool:
    """Update version in firmware/platformio.ini."""
    ini_path = Path("firmware/platformio.ini")
    if not ini_path.exists():
        print(f"Warning: {ini_path} not found")
        return False

    content = ini_path.read_text()
    
    # Match: firmware_version = 1.5.0 (with optional semicolon comment)
    # Also handle versions with prerelease suffixes like 1.5.0-alpha
    pattern = r'(firmware_version\s*=\s*)([\d.]+(?:-[a-zA-Z0-9.-]+)?)'
    
    # Check if pattern matches
    if not re.search(pattern, content):
        print(f"Warning: Could not find firmware_version in {ini_path}")
        return False
    
    # Replace using lambda to avoid regex group reference issues
    new_content = re.sub(
        pattern,
        lambda m: m.group(1) + version,
        content
    )
    
    if new_content == content:
        print(f"Warning: Version replacement didn't change content in {ini_path}")
        return False
    
    ini_path.write_text(new_content)
    print(f"✓ Updated {ini_path}: firmware_version = {version}")
    return True


def update_package_json_version(package_path: Path, version: str) -> bool:
    """Update version in a package.json file."""
    if not package_path.exists():
        print(f"Warning: {package_path} not found")
        return False

    try:
        with open(package_path, 'r', encoding='utf-8') as f:
            data = json.load(f)
        
        old_version = data.get('version', '')
        data['version'] = version
        
        with open(package_path, 'w', encoding='utf-8') as f:
            json.dump(data, f, indent=2)
            f.write('\n')  # Add trailing newline
        
        print(f"✓ Updated {package_path}: version = {version} (was {old_version})")
        return True
    except json.JSONDecodeError as e:
        print(f"Error: Failed to parse {package_path}: {e}")
        return False
    except Exception as e:
        print(f"Error: Failed to update {package_path}: {e}")
        return False


def update_readme_version(version: str) -> bool:
    """Update version in README.md."""
    readme_path = Path("README.md")
    if not readme_path.exists():
        print(f"Warning: {readme_path} not found")
        return False

    content = readme_path.read_text()
    
    # Match: **Current Version: 1.5.2**
    # Also handle versions with prerelease suffixes
    pattern = r'(\*\*Current Version:\s*)([\d.]+(?:-[a-zA-Z0-9.-]+)?)(\*\*)'
    
    # Check if pattern matches
    if not re.search(pattern, content):
        print(f"Warning: Could not find 'Current Version' in {readme_path}")
        return False
    
    # Replace using lambda to avoid regex group reference issues
    new_content = re.sub(
        pattern,
        lambda m: m.group(1) + version + m.group(3),
        content
    )
    
    if new_content == content:
        print(f"Warning: Version replacement didn't change content in {readme_path}")
        return False
    
    readme_path.write_text(new_content)
    print(f"✓ Updated {readme_path}: Current Version = {version}")
    return True


def normalize_version(version: str) -> str:
    """Normalize version string (remove 'v' prefix if present)."""
    version = version.strip()
    if version.startswith('v'):
        version = version[1:]
    return version


def validate_version(version: str) -> bool:
    """Validate version format (semver-like: x.y.z)."""
    pattern = r'^\d+\.\d+\.\d+(-[a-zA-Z0-9.-]+)?$'
    return bool(re.match(pattern, version))


def main() -> int:
    """Main entry point."""
    if len(sys.argv) < 2:
        print("Usage: python scripts/update_version.py <version>")
        print("Example: python scripts/update_version.py 1.5.0")
        return 1
    
    version = normalize_version(sys.argv[1])
    
    if not validate_version(version):
        print(f"Error: Invalid version format: {version}")
        print("Expected format: x.y.z or x.y.z-prerelease")
        return 1
    
    print(f"Updating versions to {version}...")
    print()
    
    success_count = 0
    total_count = 0
    
    # Update firmware/platformio.ini
    total_count += 1
    if update_platformio_version(version):
        success_count += 1
    
    # Update website/package.json
    total_count += 1
    if update_package_json_version(Path("website/package.json"), version):
        success_count += 1
    
    # Update bridge/package.json
    total_count += 1
    if update_package_json_version(Path("bridge/package.json"), version):
        success_count += 1
    
    # Update README.md
    total_count += 1
    if update_readme_version(version):
        success_count += 1
    
    print()
    if success_count == total_count:
        print(f"✓ Successfully updated all {success_count} version locations")
        return 0
    else:
        print(f"⚠ Updated {success_count}/{total_count} version locations")
        return 0 if success_count > 0 else 1


if __name__ == "__main__":
    sys.exit(main())
