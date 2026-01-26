#!/bin/bash
# Pre-Deployment Checklist for Azure Bridge Deployment

echo "======================================"
echo "Azure Deployment - Pre-Flight Check"
echo "======================================"
echo ""

# Check 1: Azure CLI
if command -v az &> /dev/null; then
    echo "✅ Azure CLI installed"
    az version --query '"azure-cli"' -o tsv | xargs -I {} echo "   Version: {}"
else
    echo "❌ Azure CLI not found"
    exit 1
fi

# Check 2: Azure Login
if az account show &> /dev/null; then
    echo "✅ Logged into Azure"
    az account show --query "{Subscription:name,User:user.name}" -o tsv | while IFS=$'\t' read -r sub user; do
        echo "   Subscription: $sub"
        echo "   User: $user"
    done
else
    echo "❌ Not logged into Azure"
    echo "   Run: az login"
    exit 1
fi

# Check 3: Docker
if command -v docker &> /dev/null; then
    echo "✅ Docker installed"
    docker --version | xargs -I {} echo "   {}"

    # Check if Docker is running
    if docker info &> /dev/null; then
        echo "✅ Docker is running"
    else
        echo "⚠️  Docker is installed but not running"
        echo "   Please start Docker Desktop"
        exit 1
    fi
else
    echo "❌ Docker not found"
    echo "   Install Docker Desktop: https://www.docker.com/products/docker-desktop"
    exit 1
fi

# Check 4: GitHub Username
if [ -z "$GITHUB_USER" ]; then
    echo "⚠️  GITHUB_USER not set"
    echo "   Run: export GITHUB_USER=liptonj"
    NEEDS_SETUP=true
else
    echo "✅ GitHub username set: $GITHUB_USER"
fi

# Check 5: GitHub Token
if [ -z "$GITHUB_TOKEN" ]; then
    echo "⚠️  GITHUB_TOKEN not set"
    echo ""
    echo "   Create token at: https://github.com/settings/tokens/new"
    echo "   Required scopes:"
    echo "     - ✅ write:packages (to push container images)"
    echo "     - ✅ read:packages (to pull container images)"
    echo ""
    echo "   Then run: export GITHUB_TOKEN=ghp_your_token_here"
    NEEDS_SETUP=true
else
    echo "✅ GitHub token set"
fi

echo ""
if [ "$NEEDS_SETUP" = true ]; then
    echo "======================================"
    echo "⚠️  Setup Required"
    echo "======================================"
    echo ""
    echo "Run these commands:"
    echo ""
    echo "  export GITHUB_USER=liptonj"
    echo "  export GITHUB_TOKEN=ghp_your_token_here"
    echo ""
    echo "Then re-run this checklist:"
    echo "  ./pre-deployment-check.sh"
    echo ""
else
    echo "======================================"
    echo "✅ All checks passed!"
    echo "======================================"
    echo ""
    echo "Ready to deploy! Run:"
    echo "  ./azure-deploy.sh"
    echo ""
    echo "Estimated deployment time: 5-10 minutes"
    echo "Estimated monthly cost: ~$17 (covered by Azure credit)"
    echo ""
fi
