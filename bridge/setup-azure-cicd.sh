#!/bin/bash
# Automated Azure GitHub Actions Setup (Non-Interactive)
# Creates service principal and displays instructions for adding to GitHub

set -e

echo "======================================"
echo "Azure GitHub Actions Setup"
echo "======================================"
echo ""

# Check Azure login
if ! az account show &> /dev/null 2>&1; then
    echo "❌ Not logged into Azure"
    echo "   Run: az login"
    exit 1
fi

echo "✅ Azure CLI ready"

# Get subscription info
SUBSCRIPTION_ID=$(az account show --query id -o tsv)
SUBSCRIPTION_NAME=$(az account show --query name -o tsv)

echo ""
echo "Subscription:"
echo "  Name: $SUBSCRIPTION_NAME"
echo "  ID: $SUBSCRIPTION_ID"
echo ""

# Delete existing service principal if present
SP_NAME="github-actions-webex-bridge"
EXISTING_SP=$(az ad sp list --display-name "$SP_NAME" --query "[0].appId" -o tsv 2>/dev/null || echo "")

if [ -n "$EXISTING_SP" ]; then
    echo "Deleting existing service principal: $SP_NAME"
    az ad sp delete --id "$EXISTING_SP" 2>/dev/null || true
    sleep 2
fi

# Create service principal
echo "Creating service principal..."
echo "  Name: $SP_NAME"
echo "  Scope: Subscription level"
echo ""

SP_OUTPUT=$(az ad sp create-for-rbac \
    --name "$SP_NAME" \
    --role contributor \
    --scopes /subscriptions/$SUBSCRIPTION_ID \
    --sdk-auth 2>&1)

if [ $? -ne 0 ]; then
    echo "❌ Failed to create service principal"
    echo "$SP_OUTPUT"
    exit 1
fi

echo "✅ Service principal created"
echo ""

# Save to file
CREDENTIALS_FILE="azure-credentials.json"
echo "$SP_OUTPUT" > "$CREDENTIALS_FILE"

echo "======================================"
echo "✅ Credentials Created!"
echo "======================================"
echo ""
echo "Credentials saved to: $CREDENTIALS_FILE"
echo ""
echo "Next steps:"
echo ""
echo "1. Go to GitHub repository settings:"
echo "   https://github.com/liptonj/Led-Matrix-Webex/settings/secrets/actions"
echo ""
echo "2. Click 'New repository secret'"
echo ""
echo "3. Add secret:"
echo "   Name: AZURE_CREDENTIALS"
echo "   Value: (contents of azure-credentials.json below)"
echo ""
echo "────────────────────────────────────"
cat "$CREDENTIALS_FILE"
echo "────────────────────────────────────"
echo ""
echo "4. Enable workflow permissions:"
echo "   https://github.com/liptonj/Led-Matrix-Webex/settings/actions"
echo "   → Workflow permissions: 'Read and write permissions'"
echo ""
echo "5. Push to deploy:"
echo "   git add ."
echo "   git commit -m 'feat: enable Azure CI/CD'"
echo "   git push origin main"
echo ""
echo "⚠️  Delete azure-credentials.json after adding to GitHub!"
echo ""
