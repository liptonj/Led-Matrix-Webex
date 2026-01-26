#!/bin/bash
# Setup Azure Service Principal for GitHub Actions
# This creates credentials that allow GitHub Actions to deploy to Azure automatically

set -e

echo "======================================"
echo "Azure GitHub Actions Setup"
echo "======================================"
echo ""

# Check prerequisites
if ! command -v az &> /dev/null; then
    echo "❌ Azure CLI not found. Please install it first:"
    echo "   ./install-azure-cli.sh"
    exit 1
fi

if ! command -v gh &> /dev/null; then
    echo "⚠️  GitHub CLI (gh) not found - you'll need to add secrets manually"
    echo "   Install: brew install gh"
    MANUAL_MODE=true
else
    MANUAL_MODE=false
fi

# Check Azure login
if ! az account show &> /dev/null; then
    echo "❌ Not logged into Azure"
    echo "   Run: az login"
    exit 1
fi

echo "✅ Azure CLI ready"
echo ""

# Get subscription info
SUBSCRIPTION_ID=$(az account show --query id -o tsv)
SUBSCRIPTION_NAME=$(az account show --query name -o tsv)

echo "Subscription:"
echo "  Name: $SUBSCRIPTION_NAME"
echo "  ID: $SUBSCRIPTION_ID"
echo ""

# Confirm
read -p "Create service principal for GitHub Actions? (y/n) " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "Aborted"
    exit 0
fi

# Check if service principal already exists
SP_NAME="github-actions-webex-bridge"
EXISTING_SP=$(az ad sp list --display-name "$SP_NAME" --query "[0].appId" -o tsv 2>/dev/null || echo "")

if [ -n "$EXISTING_SP" ]; then
    echo "⚠️  Service principal already exists"
    read -p "Delete and recreate? (y/n) " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        echo "Deleting existing service principal..."
        az ad sp delete --id "$EXISTING_SP"
        echo "✓ Deleted"
    else
        echo "Using existing service principal: $EXISTING_SP"
    fi
fi

# Create service principal
echo "Creating service principal..."
echo "  Name: $SP_NAME"
echo "  Scope: /subscriptions/$SUBSCRIPTION_ID"
echo ""

SP_OUTPUT=$(az ad sp create-for-rbac \
    --name "$SP_NAME" \
    --role contributor \
    --scopes /subscriptions/$SUBSCRIPTION_ID \
    --sdk-auth)

if [ $? -ne 0 ]; then
    echo "❌ Failed to create service principal"
    exit 1
fi

echo "✅ Service principal created"
echo ""

# Save to temp file
TEMP_FILE=$(mktemp)
echo "$SP_OUTPUT" > "$TEMP_FILE"

echo "======================================"
echo "GitHub Secret Configuration"
echo "======================================"
echo ""

if [ "$MANUAL_MODE" = true ]; then
    echo "📋 Manual Setup Required"
    echo ""
    echo "1. Go to: https://github.com/$(git config --get remote.origin.url | sed 's/.*github.com[:/]\(.*\)\.git/\1/')/settings/secrets/actions"
    echo ""
    echo "2. Click 'New repository secret'"
    echo ""
    echo "3. Name: AZURE_CREDENTIALS"
    echo ""
    echo "4. Value: Copy the JSON below"
    echo ""
    echo "────────────────────────────────────"
    cat "$TEMP_FILE"
    echo "────────────────────────────────────"
    echo ""
    echo "5. Click 'Add secret'"
    echo ""
else
    echo "Attempting to add secret using GitHub CLI..."

    # Check if gh is authenticated
    if ! gh auth status &> /dev/null; then
        echo "⚠️  Not logged into GitHub CLI"
        echo "   Run: gh auth login"
        MANUAL_MODE=true
    else
        # Try to add secret
        if gh secret set AZURE_CREDENTIALS < "$TEMP_FILE" 2>/dev/null; then
            echo "✅ Secret added successfully!"
            echo ""
        else
            echo "⚠️  Could not add secret automatically"
            MANUAL_MODE=true
        fi
    fi

    if [ "$MANUAL_MODE" = true ]; then
        echo ""
        echo "📋 Add manually:"
        echo "1. Go to: https://github.com/$(git config --get remote.origin.url | sed 's/.*github.com[:/]\(.*\)\.git/\1/')/settings/secrets/actions"
        echo "2. Name: AZURE_CREDENTIALS"
        echo "3. Value:"
        echo "────────────────────────────────────"
        cat "$TEMP_FILE"
        echo "────────────────────────────────────"
        echo ""
    fi
fi

# Cleanup
rm "$TEMP_FILE"

echo "======================================"
echo "✅ Setup Complete"
echo "======================================"
echo ""
echo "Next steps:"
echo ""
echo "1. Verify secret is added:"
echo "   https://github.com/$(git config --get remote.origin.url | sed 's/.*github.com[:/]\(.*\)\.git/\1/')/settings/secrets/actions"
echo ""
echo "2. Enable workflow permissions:"
echo "   https://github.com/$(git config --get remote.origin.url | sed 's/.*github.com[:/]\(.*\)\.git/\1/')/settings/actions"
echo "   → Workflow permissions: 'Read and write permissions'"
echo ""
echo "3. Trigger deployment:"
echo "   - Push to main: git push origin main"
echo "   - Or manual: https://github.com/$(git config --get remote.origin.url | sed 's/.*github.com[:/]\(.*\)\.git/\1/')/actions/workflows/deploy-bridge-azure.yml"
echo ""
echo "Cost: ~\$17/month (covered by \$100 Azure credit)"
echo ""
