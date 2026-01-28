#!/usr/bin/env bash
# =============================================================================
# Supabase Setup Script
# LED Matrix Webex Display Project
#
# This script guides you through setting up Supabase for the project.
# =============================================================================

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

log_info() { echo -e "${BLUE}[INFO]${NC} $1"; }
log_success() { echo -e "${GREEN}[SUCCESS]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARNING]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }

PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

echo ""
echo "=============================================="
echo "  Supabase Setup for LED Matrix Webex"
echo "=============================================="
echo ""

# Check prerequisites
check_prerequisites() {
    log_info "Checking prerequisites..."

    if ! command -v supabase &> /dev/null; then
        log_error "Supabase CLI not found. Install it with:"
        echo "  brew install supabase/tap/supabase"
        echo "  # or"
        echo "  npm install -g supabase"
        exit 1
    fi

    SUPABASE_VERSION=$(supabase --version 2>&1 | head -1)
    log_success "Supabase CLI installed: $SUPABASE_VERSION"
}

# Step 1: Login to Supabase
login_supabase() {
    log_info "Step 1: Checking Supabase authentication..."

    if supabase projects list &> /dev/null; then
        log_success "Already logged in to Supabase"
    else
        log_warn "Not logged in to Supabase"
        echo ""
        echo "Please login to Supabase. This will open a browser window."
        echo ""
        read -p "Press Enter to continue with login..."

        if ! supabase login; then
            log_error "Failed to login to Supabase"
            exit 1
        fi
        log_success "Logged in to Supabase"
    fi
}

# Step 2: Link project
link_project() {
    log_info "Step 2: Linking Supabase project..."

    cd "$PROJECT_ROOT/supabase"

    # Check if already linked
    if [ -f ".temp/project-ref" ]; then
        PROJECT_REF=$(cat .temp/project-ref 2>/dev/null || echo "")
        if [ -n "$PROJECT_REF" ]; then
            log_success "Project already linked: $PROJECT_REF"
            return 0
        fi
    fi

    echo ""
    echo "Available Supabase projects:"
    echo ""
    supabase projects list || true
    echo ""
    echo "Enter your Supabase project reference (from the list above)"
    echo "Or enter 'new' to create a new project"
    echo ""
    read -p "Project reference: " PROJECT_REF

    if [ "$PROJECT_REF" = "new" ]; then
        create_project
    else
        log_info "Linking to project: $PROJECT_REF"

        # Get database password
        echo ""
        echo "Enter your Supabase database password."
        echo "(This is the password you set when creating the project)"
        echo ""
        read -s -p "Database password: " DB_PASSWORD
        echo ""

        if supabase link --project-ref "$PROJECT_REF" --password "$DB_PASSWORD"; then
            log_success "Project linked successfully"

            # Save project ref for later use
            mkdir -p .temp
            echo "$PROJECT_REF" > .temp/project-ref
        else
            log_error "Failed to link project"
            exit 1
        fi
    fi
}

# Create new project
create_project() {
    log_info "Creating new Supabase project..."

    echo ""
    read -p "Organization ID (run 'supabase orgs list' to find): " ORG_ID
    read -p "Project name [led-matrix-webex]: " PROJECT_NAME
    PROJECT_NAME=${PROJECT_NAME:-led-matrix-webex}

    echo ""
    echo "Creating project '$PROJECT_NAME' in organization $ORG_ID..."
    echo ""

    # Generate a strong database password
    DB_PASSWORD=$(openssl rand -base64 24 | tr -dc 'a-zA-Z0-9' | head -c 24)

    supabase projects create "$PROJECT_NAME" \
        --org-id "$ORG_ID" \
        --db-password "$DB_PASSWORD" \
        --region us-east-1

    log_success "Project created!"
    log_warn "IMPORTANT: Save your database password securely: $DB_PASSWORD"
    echo ""

    # Wait for project to be ready
    log_info "Waiting for project to be ready (this may take 1-2 minutes)..."
    sleep 60

    # Get project ref
    PROJECT_REF=$(supabase projects list --json | jq -r ".[] | select(.name == \"$PROJECT_NAME\") | .id")

    if [ -n "$PROJECT_REF" ]; then
        log_info "Linking to new project: $PROJECT_REF"
        supabase link --project-ref "$PROJECT_REF" --password "$DB_PASSWORD"

        mkdir -p .temp
        echo "$PROJECT_REF" > .temp/project-ref
    else
        log_error "Could not find project reference. Please link manually."
        exit 1
    fi
}

# Step 3: Push database migration
push_migration() {
    log_info "Step 3: Pushing database migration..."

    cd "$PROJECT_ROOT/supabase"

    echo ""
    echo "This will apply the database schema to your Supabase project."
    echo "Migration: 20260127000000_create_display_schema.sql"
    echo ""
    echo "This creates:"
    echo "  - display.devices table"
    echo "  - display.device_logs table"
    echo "  - display.releases table"
    echo "  - Row Level Security policies"
    echo "  - firmware storage bucket"
    echo ""
    read -p "Press Enter to continue (or Ctrl+C to cancel)..."

    if supabase db push; then
        log_success "Database migration applied successfully"
    else
        log_error "Failed to apply migration"
        echo ""
        echo "If you see errors about existing objects, you may need to:"
        echo "1. Go to Supabase Dashboard > SQL Editor"
        echo "2. Run: DROP SCHEMA IF EXISTS display CASCADE;"
        echo "3. Try again"
        exit 1
    fi
}

# Step 4: Deploy Edge Functions
deploy_functions() {
    log_info "Step 4: Deploying Edge Functions..."

    cd "$PROJECT_ROOT/supabase"

    FUNCTIONS=("provision-device" "validate-device" "get-firmware" "get-manifest")

    for func in "${FUNCTIONS[@]}"; do
        log_info "Deploying $func..."
        if supabase functions deploy "$func" --no-verify-jwt; then
            log_success "Deployed $func"
        else
            log_error "Failed to deploy $func"
            exit 1
        fi
    done

    log_success "All Edge Functions deployed!"
    echo ""
    echo "Edge Function URLs:"
    PROJECT_REF=$(cat .temp/project-ref 2>/dev/null || echo "YOUR_PROJECT_REF")
    for func in "${FUNCTIONS[@]}"; do
        echo "  https://$PROJECT_REF.supabase.co/functions/v1/$func"
    done
}

# Step 5: Create admin user
create_admin_user() {
    log_info "Step 5: Creating admin user..."

    echo ""
    echo "Admin users are created through the Supabase Dashboard."
    echo ""
    echo "To create an admin user:"
    echo ""
    PROJECT_REF=$(cat "$PROJECT_ROOT/supabase/.temp/project-ref" 2>/dev/null || echo "YOUR_PROJECT_REF")
    echo "1. Go to: https://supabase.com/dashboard/project/$PROJECT_REF/auth/users"
    echo ""
    echo "2. Click 'Add user' > 'Create new user'"
    echo ""
    echo "3. Enter:"
    echo "   - Email: your admin email"
    echo "   - Password: a strong password"
    echo "   - Auto Confirm User: ON"
    echo ""
    echo "4. Click 'Create user'"
    echo ""
    log_warn "IMPORTANT: Remember to save the admin credentials securely!"
    echo ""
    read -p "Press Enter after creating the admin user..."

    log_success "Admin user setup complete"
}

# Step 6: Output configuration
output_config() {
    log_info "Step 6: Retrieving project configuration..."

    cd "$PROJECT_ROOT/supabase"

    PROJECT_REF=$(cat .temp/project-ref 2>/dev/null || echo "")

    if [ -z "$PROJECT_REF" ]; then
        log_error "Project reference not found"
        exit 1
    fi

    echo ""
    echo "=============================================="
    echo "  Supabase Configuration - SAVE THESE VALUES"
    echo "=============================================="
    echo ""
    echo "Project URL:"
    echo "  SUPABASE_URL=https://$PROJECT_REF.supabase.co"
    echo ""
    echo "API Keys (find in Dashboard > Settings > API):"
    echo "  https://supabase.com/dashboard/project/$PROJECT_REF/settings/api"
    echo ""
    echo "  SUPABASE_ANON_KEY=<your anon key>"
    echo "  SUPABASE_SERVICE_ROLE_KEY=<your service_role key>"
    echo ""
    echo "=============================================="
    echo ""
    log_success "Supabase setup complete!"
    echo ""
    echo "Next steps:"
    echo "  1. Copy the API keys from the Dashboard"
    echo "  2. Run: ./scripts/configure-secrets.sh"
    echo "  3. Update your .env files with the configuration"
    echo ""
}

# Main execution
main() {
    check_prerequisites
    login_supabase
    link_project
    push_migration
    deploy_functions
    create_admin_user
    output_config
}

main "$@"
