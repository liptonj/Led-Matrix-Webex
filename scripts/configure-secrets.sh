#!/usr/bin/env bash
# =============================================================================
# Configure Secrets Script
# LED Matrix Webex Display Project
#
# This script helps configure secrets for GitHub, Azure, and Cloudflare.
# =============================================================================

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

log_info() { echo -e "${BLUE}[INFO]${NC} $1"; }
log_success() { echo -e "${GREEN}[SUCCESS]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARNING]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }
log_section() { echo -e "\n${CYAN}=== $1 ===${NC}\n"; }

PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

echo ""
echo "=============================================="
echo "  Configure Secrets for LED Matrix Webex"
echo "=============================================="
echo ""

# Check prerequisites
check_prerequisites() {
    log_info "Checking prerequisites..."

    if ! command -v gh &> /dev/null; then
        log_error "GitHub CLI (gh) not found. Install it with:"
        echo "  brew install gh"
        exit 1
    fi

    if ! gh auth status &> /dev/null; then
        log_warn "Not logged in to GitHub CLI"
        echo ""
        read -p "Press Enter to login to GitHub..."
        gh auth login
    fi

    log_success "GitHub CLI authenticated"
}

# Get Supabase configuration
get_supabase_config() {
    log_section "Supabase Configuration"

    PROJECT_REF_FILE="$PROJECT_ROOT/supabase/.temp/project-ref"

    if [ -f "$PROJECT_REF_FILE" ]; then
        PROJECT_REF=$(cat "$PROJECT_REF_FILE")
        SUPABASE_URL="https://$PROJECT_REF.supabase.co"
        echo "Detected Supabase project: $PROJECT_REF"
        echo "URL: $SUPABASE_URL"
        echo ""
    else
        echo "Enter your Supabase project URL:"
        read -p "SUPABASE_URL: " SUPABASE_URL
    fi

    echo ""
    echo "Get your API keys from:"
    echo "  https://supabase.com/dashboard/project/${PROJECT_REF:-YOUR_PROJECT}/settings/api"
    echo ""

    read -s -p "SUPABASE_ANON_KEY: " SUPABASE_ANON_KEY
    echo ""
    read -s -p "SUPABASE_SERVICE_ROLE_KEY: " SUPABASE_SERVICE_ROLE_KEY
    echo ""

    if [ -z "$SUPABASE_URL" ] || [ -z "$SUPABASE_ANON_KEY" ] || [ -z "$SUPABASE_SERVICE_ROLE_KEY" ]; then
        log_error "All Supabase values are required"
        exit 1
    fi

    log_success "Supabase configuration collected"
}

# Configure GitHub Secrets
configure_github_secrets() {
    log_section "GitHub Repository Secrets"

    REPO=$(gh repo view --json nameWithOwner -q .nameWithOwner 2>/dev/null || echo "")

    if [ -z "$REPO" ]; then
        log_error "Could not detect GitHub repository. Run from the project directory."
        exit 1
    fi

    log_info "Repository: $REPO"
    echo ""
    echo "The following secrets will be added/updated:"
    echo "  - SUPABASE_URL"
    echo "  - SUPABASE_SERVICE_ROLE_KEY"
    echo ""
    read -p "Continue? (y/n): " CONFIRM

    if [ "$CONFIRM" != "y" ]; then
        log_warn "Skipping GitHub secrets"
        return
    fi

    log_info "Setting SUPABASE_URL..."
    echo "$SUPABASE_URL" | gh secret set SUPABASE_URL

    log_info "Setting SUPABASE_SERVICE_ROLE_KEY..."
    echo "$SUPABASE_SERVICE_ROLE_KEY" | gh secret set SUPABASE_SERVICE_ROLE_KEY

    log_success "GitHub secrets configured"

    # Check for other required secrets
    echo ""
    log_info "Checking other required secrets..."

    EXISTING_SECRETS=$(gh secret list --json name -q '.[].name' 2>/dev/null || echo "")

    # Check Cloudflare secrets
    if echo "$EXISTING_SECRETS" | grep -q "CLOUDFLARE_API_TOKEN"; then
        log_success "CLOUDFLARE_API_TOKEN exists"
    else
        log_warn "CLOUDFLARE_API_TOKEN not set"
        echo "  Required for website deployment to Cloudflare Pages"
        echo "  Get from: https://dash.cloudflare.com/profile/api-tokens"
        echo ""
        read -p "Set CLOUDFLARE_API_TOKEN now? (y/n): " SET_CF
        if [ "$SET_CF" = "y" ]; then
            read -s -p "CLOUDFLARE_API_TOKEN: " CF_TOKEN
            echo ""
            echo "$CF_TOKEN" | gh secret set CLOUDFLARE_API_TOKEN
            log_success "CLOUDFLARE_API_TOKEN set"
        fi
    fi

    if echo "$EXISTING_SECRETS" | grep -q "CLOUDFLARE_ACCOUNT_ID"; then
        log_success "CLOUDFLARE_ACCOUNT_ID exists"
    else
        log_warn "CLOUDFLARE_ACCOUNT_ID not set"
        echo "  Required for website deployment to Cloudflare Pages"
        echo "  Find in: Cloudflare Dashboard > Workers & Pages > Account ID"
        echo ""
        read -p "Set CLOUDFLARE_ACCOUNT_ID now? (y/n): " SET_CF_ID
        if [ "$SET_CF_ID" = "y" ]; then
            read -p "CLOUDFLARE_ACCOUNT_ID: " CF_ACCOUNT_ID
            echo "$CF_ACCOUNT_ID" | gh secret set CLOUDFLARE_ACCOUNT_ID
            log_success "CLOUDFLARE_ACCOUNT_ID set"
        fi
    fi

    # Check Azure secrets
    if echo "$EXISTING_SECRETS" | grep -q "AZURE_CREDENTIALS"; then
        log_success "AZURE_CREDENTIALS exists"
    else
        log_warn "AZURE_CREDENTIALS not set"
        echo "  Required for bridge deployment to Azure Container Apps"
        echo "  See: .github/workflows/AZURE_SECRETS_SETUP.md"
    fi
}

# Configure Azure Container App environment
configure_azure() {
    log_section "Azure Container Apps Configuration"

    if ! command -v az &> /dev/null; then
        log_warn "Azure CLI not installed. Skipping Azure configuration."
        echo "Install with: brew install azure-cli"
        echo ""
        echo "Manual steps required:"
        echo "1. Login to Azure: az login"
        echo "2. Update container app environment variables:"
        echo "   az containerapp update \\"
        echo "     --name webex-bridge \\"
        echo "     --resource-group webex-bridge-rg \\"
        echo "     --set-env-vars \\"
        echo "       SUPABASE_URL=$SUPABASE_URL \\"
        echo "       SUPABASE_SERVICE_ROLE_KEY=<your-service-role-key>"
        return
    fi

    # Check if logged in
    if ! az account show &> /dev/null; then
        log_warn "Not logged in to Azure CLI"
        read -p "Login to Azure? (y/n): " LOGIN_AZURE
        if [ "$LOGIN_AZURE" = "y" ]; then
            az login
        else
            log_warn "Skipping Azure configuration"
            return
        fi
    fi

    CONTAINER_APP="webex-bridge"
    RESOURCE_GROUP="webex-bridge-rg"

    # Check if container app exists
    if ! az containerapp show --name "$CONTAINER_APP" --resource-group "$RESOURCE_GROUP" &> /dev/null; then
        log_warn "Container app '$CONTAINER_APP' not found in '$RESOURCE_GROUP'"
        echo "The container app will be created on first deployment."
        echo ""
        echo "After deployment, update environment variables manually:"
        echo "  az containerapp update \\"
        echo "    --name $CONTAINER_APP \\"
        echo "    --resource-group $RESOURCE_GROUP \\"
        echo "    --set-env-vars \\"
        echo "      SUPABASE_URL=$SUPABASE_URL \\"
        echo "      SUPABASE_SERVICE_ROLE_KEY=secretref:supabase-service-key"
        return
    fi

    echo ""
    echo "Found Azure Container App: $CONTAINER_APP"
    echo ""
    read -p "Update environment variables now? (y/n): " UPDATE_AZURE

    if [ "$UPDATE_AZURE" = "y" ]; then
        log_info "Updating Container App environment variables..."

        az containerapp update \
            --name "$CONTAINER_APP" \
            --resource-group "$RESOURCE_GROUP" \
            --set-env-vars \
                "SUPABASE_URL=$SUPABASE_URL" \
                "SUPABASE_SERVICE_ROLE_KEY=$SUPABASE_SERVICE_ROLE_KEY"

        log_success "Azure Container App updated"
    fi
}

# Configure Cloudflare Pages environment
configure_cloudflare() {
    log_section "Cloudflare Pages Configuration"

    echo "Cloudflare Pages environment variables must be set in the dashboard."
    echo ""
    echo "1. Go to: https://dash.cloudflare.com"
    echo "2. Select: Workers & Pages > led-matrix-webex > Settings > Environment variables"
    echo "3. Add production variables:"
    echo ""
    echo "   NEXT_PUBLIC_SUPABASE_URL = $SUPABASE_URL"
    echo "   NEXT_PUBLIC_SUPABASE_ANON_KEY = $SUPABASE_ANON_KEY"
    echo ""
    read -p "Press Enter after configuring Cloudflare Pages..."
    log_success "Cloudflare Pages configuration noted"
}

# Create local .env files
create_env_files() {
    log_section "Local Environment Files"

    # Website .env
    WEBSITE_ENV="$PROJECT_ROOT/website/.env"
    echo ""
    echo "Create $WEBSITE_ENV?"
    read -p "(y/n): " CREATE_WEBSITE_ENV

    if [ "$CREATE_WEBSITE_ENV" = "y" ]; then
        cat > "$WEBSITE_ENV" << EOF
# Supabase Configuration (for admin dashboard)
NEXT_PUBLIC_SUPABASE_URL=$SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY=$SUPABASE_ANON_KEY
EOF
        log_success "Created $WEBSITE_ENV"
    fi

    # Bridge .env
    BRIDGE_ENV="$PROJECT_ROOT/bridge/.env"
    echo ""
    echo "Create $BRIDGE_ENV?"
    read -p "(y/n): " CREATE_BRIDGE_ENV

    if [ "$CREATE_BRIDGE_ENV" = "y" ]; then
        cat > "$BRIDGE_ENV" << EOF
# WebSocket Server Configuration
WS_PORT=8080
LOG_LEVEL=info
DATA_DIR=./data

# mDNS Service Name
MDNS_SERVICE_NAME=webex-bridge

# Supabase Configuration (for cloud device management)
SUPABASE_URL=$SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY=$SUPABASE_SERVICE_ROLE_KEY
EOF
        log_success "Created $BRIDGE_ENV"
        log_warn "Remember: Never commit .env files to git!"
    fi
}

# Summary
print_summary() {
    log_section "Configuration Summary"

    echo "Supabase Configuration:"
    echo "  URL: $SUPABASE_URL"
    echo "  Anon Key: ${SUPABASE_ANON_KEY:0:20}..."
    echo "  Service Role Key: ${SUPABASE_SERVICE_ROLE_KEY:0:20}..."
    echo ""
    echo "Configured:"
    echo "  [✓] GitHub Repository Secrets"
    echo "  [ ] Azure Container Apps (manual: az containerapp update)"
    echo "  [ ] Cloudflare Pages (manual: dashboard)"
    echo ""
    echo "Local files created:"
    [ -f "$PROJECT_ROOT/website/.env" ] && echo "  [✓] website/.env"
    [ -f "$PROJECT_ROOT/bridge/.env" ] && echo "  [✓] bridge/.env"
    echo ""

    log_success "Secret configuration complete!"
    echo ""
    echo "Next steps:"
    echo "  1. Configure Cloudflare Pages environment variables (see above)"
    echo "  2. Deploy bridge to Azure: git push origin main"
    echo "  3. After Azure deploys, update env vars:"
    echo "     az containerapp update --name webex-bridge --resource-group webex-bridge-rg \\"
    echo "       --set-env-vars SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=..."
    echo "  4. Test the admin dashboard: npm run dev (in website/)"
    echo ""
}

# Main execution
main() {
    check_prerequisites
    get_supabase_config
    configure_github_secrets
    configure_azure
    configure_cloudflare
    create_env_files
    print_summary
}

main "$@"
