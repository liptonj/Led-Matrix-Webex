#!/bin/bash
# Azure CLI Installation Script for macOS
# Run this in your terminal with: bash install-azure-cli.sh

set -e

echo "======================================"
echo "Azure CLI Installation"
echo "======================================"
echo ""

# Check if brew is installed
if ! command -v brew &> /dev/null; then
    echo "❌ Homebrew not found. Installing Homebrew first..."
    /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
fi

echo "✅ Homebrew found"
echo ""

# Fix Homebrew permissions if needed
echo "Checking Homebrew permissions..."
if [ ! -w "/opt/homebrew/Cellar" ]; then
    echo "⚠️  Fixing Homebrew permissions (requires sudo)..."
    sudo chown -R $(whoami) /opt/homebrew/Cellar
    echo "✅ Permissions fixed"
fi

# Check if Azure CLI is already installed
if command -v az &> /dev/null; then
    CURRENT_VERSION=$(az version --query '"azure-cli"' -o tsv 2>/dev/null || echo "unknown")
    echo "ℹ️  Azure CLI is already installed (version: $CURRENT_VERSION)"
    read -p "Do you want to upgrade it? (y/n) " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        echo "Upgrading Azure CLI..."
        brew upgrade azure-cli
    else
        echo "Skipping upgrade."
        exit 0
    fi
else
    echo "Installing Azure CLI..."
    brew update
    brew install azure-cli
fi

echo ""
echo "======================================"
echo "✅ Installation Complete!"
echo "======================================"
echo ""

# Verify installation
if command -v az &> /dev/null; then
    AZ_VERSION=$(az version --query '"azure-cli"' -o tsv)
    echo "✅ Azure CLI installed successfully"
    echo "   Version: $AZ_VERSION"
    echo ""
    echo "Next steps:"
    echo "1. Login to Azure:"
    echo "   az login"
    echo ""
    echo "2. Set your GitHub username for deployment:"
    echo "   export GITHUB_USER=liptonj"
    echo ""
    echo "3. Create GitHub Personal Access Token:"
    echo "   https://github.com/settings/tokens"
    echo "   - Check 'write:packages' scope"
    echo "   - Save the token (ghp_...)"
    echo ""
    echo "4. Set GitHub token:"
    echo "   export GITHUB_TOKEN=ghp_your_token_here"
    echo ""
    echo "5. Run deployment:"
    echo "   cd bridge"
    echo "   ./azure-deploy.sh"
else
    echo "❌ Installation failed. Please install manually:"
    echo "   https://docs.microsoft.com/en-us/cli/azure/install-azure-cli-macos"
    exit 1
fi
