#!/bin/bash
# Deploy Webex Bridge to Azure Container Instances
#
# Prerequisites:
# - Azure CLI installed: https://docs.microsoft.com/en-us/cli/azure/install-azure-cli
# - Docker installed and running
# - GitHub Personal Access Token with packages:write scope
# - Logged in: az login

set -e

# Configuration
RESOURCE_GROUP="webex-bridge-rg"
LOCATION="eastus"
CONTAINER_NAME="webex-bridge"
DNS_LABEL="webex-bridge-${RANDOM}"  # Temporary - use Cloudflare instead

# GitHub Container Registry (saves $5/month vs Azure Container Registry!)
GITHUB_USER="${GITHUB_USER:-liptonj}"  # Change to your GitHub username
IMAGE_NAME="ghcr.io/${GITHUB_USER}/webex-bridge:latest"

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}Webex Bridge - Azure Deployment${NC}"
echo -e "${BLUE}Using GitHub Container Registry${NC}"
echo -e "${BLUE}========================================${NC}"

# Check prerequisites
if ! command -v az &> /dev/null; then
    echo -e "${RED}Azure CLI not found. Please install: https://aka.ms/azure-cli${NC}"
    exit 1
fi

if ! command -v docker &> /dev/null; then
    echo -e "${RED}Docker not found. Please install Docker Desktop${NC}"
    exit 1
fi

# Check GitHub token
if [ -z "$GITHUB_TOKEN" ]; then
    echo -e "${YELLOW}Warning: GITHUB_TOKEN not set${NC}"
    echo -e "${YELLOW}You'll need a GitHub Personal Access Token with 'packages:write' scope${NC}"
    echo -e "${YELLOW}Create one at: https://github.com/settings/tokens${NC}"
    echo -e "${YELLOW}Then: export GITHUB_TOKEN=ghp_...${NC}"
    read -p "Press Enter to continue if already logged in, or Ctrl+C to abort..."
fi

# Check Azure login
echo -e "${BLUE}Checking Azure login...${NC}"
if ! az account show &> /dev/null; then
    echo -e "${YELLOW}Not logged in. Running az login...${NC}"
    az login
fi

# Get subscription
SUBSCRIPTION_ID=$(az account show --query id -o tsv)
echo -e "${GREEN}Using subscription: ${SUBSCRIPTION_ID}${NC}"

# Create resource group
echo -e "${BLUE}Creating resource group: ${RESOURCE_GROUP}${NC}"
az group create \
    --name $RESOURCE_GROUP \
    --location $LOCATION \
    --output table

# Build and push Docker image to GitHub Container Registry
echo -e "${BLUE}Building Docker image...${NC}"
docker build -f Dockerfile.azure -t $IMAGE_NAME .

echo -e "${BLUE}Logging into GitHub Container Registry...${NC}"
if [ -n "$GITHUB_TOKEN" ]; then
    echo $GITHUB_TOKEN | docker login ghcr.io -u $GITHUB_USER --password-stdin
else
    echo -e "${YELLOW}Please enter your GitHub Personal Access Token:${NC}"
    docker login ghcr.io -u $GITHUB_USER
fi

echo -e "${BLUE}Pushing image to GitHub Container Registry...${NC}"
docker push $IMAGE_NAME

echo -e "${GREEN}Image pushed: ${IMAGE_NAME}${NC}"
echo -e "${GREEN}Savings: \$5/month by using GitHub instead of Azure Container Registry!${NC}"

# Create Azure File Share for persistent storage
echo -e "${BLUE}Creating storage account for persistent data...${NC}"
STORAGE_ACCOUNT="webexbridgedata${RANDOM}"
az storage account create \
    --resource-group $RESOURCE_GROUP \
    --name $STORAGE_ACCOUNT \
    --location $LOCATION \
    --sku Standard_LRS \
    --output table

STORAGE_KEY=$(az storage account keys list \
    --resource-group $RESOURCE_GROUP \
    --account-name $STORAGE_ACCOUNT \
    --query "[0].value" -o tsv)

echo -e "${BLUE}Creating file share...${NC}"
az storage share create \
    --name "bridgedata" \
    --account-name $STORAGE_ACCOUNT \
    --account-key $STORAGE_KEY \
    --output table

# Deploy Container Instance
echo -e "${BLUE}Deploying container instance...${NC}"
echo -e "${YELLOW}Note: GitHub Container Registry images are public by default${NC}"
echo -e "${YELLOW}To make private, go to: https://github.com/users/${GITHUB_USER}/packages/container/webex-bridge/settings${NC}"

az container create \
    --resource-group $RESOURCE_GROUP \
    --name $CONTAINER_NAME \
    --image $IMAGE_NAME \
    --cpu 0.5 \
    --memory 0.5 \
    --dns-name-label $DNS_LABEL \
    --ports 8080 \
    --protocol TCP \
    --environment-variables \
        WS_PORT=8080 \
        LOG_LEVEL=info \
        DATA_DIR=/data \
    --azure-file-volume-account-name $STORAGE_ACCOUNT \
    --azure-file-volume-account-key $STORAGE_KEY \
    --azure-file-volume-share-name "bridgedata" \
    --azure-file-volume-mount-path /data \
    --restart-policy Always \
    --output table

# Note: If using private GitHub registry, add these flags:
#     --registry-login-server ghcr.io \
#     --registry-username $GITHUB_USER \
#     --registry-password $GITHUB_TOKEN \

# Get public IP
echo -e "${BLUE}Getting container information...${NC}"
CONTAINER_IP=$(az container show \
    --resource-group $RESOURCE_GROUP \
    --name $CONTAINER_NAME \
    --query ipAddress.ip -o tsv)

CONTAINER_FQDN=$(az container show \
    --resource-group $RESOURCE_GROUP \
    --name $CONTAINER_NAME \
    --query ipAddress.fqdn -o tsv)

echo -e "${BLUE}========================================${NC}"
echo -e "${GREEN}Deployment Complete!${NC}"
echo -e "${BLUE}========================================${NC}"
echo -e "${GREEN}Container IP:${NC} ${CONTAINER_IP}"
echo -e "${GREEN}Container FQDN:${NC} ${CONTAINER_FQDN}"
echo -e "${GREEN}WebSocket URL:${NC} ws://${CONTAINER_FQDN}:8080"
echo -e "${GREEN}Image:${NC} ${IMAGE_NAME}"
echo -e "${BLUE}========================================${NC}"
echo ""
echo -e "${GREEN}💰 Cost Savings:${NC}"
echo "Using GitHub Container Registry saves \$5/month!"
echo "Estimated monthly cost: ~\$17/month (vs \$22 with Azure CR)"
echo ""
echo -e "${YELLOW}Next Steps:${NC}"
echo "1. Configure Cloudflare DNS:"
echo "   - Add A record: bridge.5ls.us -> ${CONTAINER_IP}"
echo "2. Enable Cloudflare proxy (orange cloud)"
echo "3. Update bridge-config.json with: wss://bridge.5ls.us"
echo "4. Test connection: wscat -c wss://bridge.5ls.us"
echo ""
echo -e "${YELLOW}To view logs:${NC}"
echo "az container logs --resource-group $RESOURCE_GROUP --name $CONTAINER_NAME --follow"
echo ""
echo -e "${YELLOW}To update container (push new image):${NC}"
echo "docker build -f Dockerfile.azure -t $IMAGE_NAME . && docker push $IMAGE_NAME"
echo "az container restart --resource-group $RESOURCE_GROUP --name $CONTAINER_NAME"
echo ""
echo -e "${YELLOW}To delete deployment:${NC}"
echo "az group delete --name $RESOURCE_GROUP --yes --no-wait"
