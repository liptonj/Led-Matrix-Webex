# GitHub Actions Secrets Setup for Azure Deployment

This document explains how to set up the required secrets for automated Azure deployment.

## Required Secrets

### 1. AZURE_CREDENTIALS

Azure service principal credentials for GitHub Actions to deploy to Azure.

**Setup:**

1. **Login to Azure CLI:**
   ```bash
   az login
   ```

2. **Get your subscription ID:**
   ```bash
   az account show --query id -o tsv
   ```

3. **Create service principal:**
   ```bash
   az ad sp create-for-rbac \
     --name "github-actions-webex-bridge" \
     --role contributor \
     --scopes /subscriptions/71beea79-9d64-4c0f-96a6-d490613ddfdb/resourceGroups/webex-bridge-rg \
     --sdk-auth
   ```

   This will output JSON like:
   ```json
   {
     "clientId": "...",
     "clientSecret": "...",
     "subscriptionId": "...",
     "tenantId": "...",
     "activeDirectoryEndpointUrl": "...",
     "resourceManagerEndpointUrl": "...",
     "activeDirectoryGraphResourceId": "...",
     "sqlManagementEndpointUrl": "...",
     "galleryEndpointUrl": "...",
     "managementEndpointUrl": "..."
   }
   ```

4. **Copy the entire JSON output**

5. **Add to GitHub Secrets:**
   - Go to: https://github.com/YOUR_USERNAME/Led-Matrix-Webex/settings/secrets/actions
   - Click **New repository secret**
   - Name: `AZURE_CREDENTIALS`
   - Value: Paste the entire JSON
   - Click **Add secret**

### Alternative: Create with broader scope (if resource group doesn't exist yet)

```bash
# Get subscription ID
SUBSCRIPTION_ID=$(az account show --query id -o tsv)

# Create service principal with subscription-level access
az ad sp create-for-rbac \
  --name "github-actions-webex-bridge" \
  --role contributor \
  --scopes /subscriptions/$SUBSCRIPTION_ID \
  --sdk-auth
```

## Verify Secrets

After adding secrets, you should have:

| Secret Name | Description | Required |
|-------------|-------------|----------|
| `AZURE_CREDENTIALS` | Azure service principal JSON | ✅ Yes |
| `GITHUB_TOKEN` | Automatically provided by GitHub | ✅ Auto |

## GitHub Packages Permissions

The workflow automatically uses `GITHUB_TOKEN` to push images to GitHub Container Registry (ghcr.io).

**Ensure package write permissions are enabled:**
1. Go to: https://github.com/YOUR_USERNAME/Led-Matrix-Webex/settings/actions
2. Scroll to **Workflow permissions**
3. Select **Read and write permissions**
4. Save

## Testing the Workflow

### Test Build Only (Pull Request)

Create a PR with changes to `bridge/` - this will build but not deploy:
```bash
git checkout -b test-bridge-build
# Make a change to bridge/
git commit -am "test: trigger bridge build"
git push origin test-bridge-build
# Create PR on GitHub
```

### Test Full Deployment (Manual Trigger)

1. Go to: https://github.com/YOUR_USERNAME/Led-Matrix-Webex/actions/workflows/deploy-bridge-azure.yml
2. Click **Run workflow**
3. Select branch: `main`
4. Click **Run workflow**

### Auto-Deploy (Push to Main)

Any push to `main` that changes `bridge/` files will automatically deploy:
```bash
git checkout main
# Make changes to bridge/
git commit -am "feat: update bridge server"
git push origin main
```

## Troubleshooting

### Error: "Authentication failed"

**Solution:** Re-create the service principal:
```bash
# Delete old service principal
az ad sp delete --id $(az ad sp list --display-name "github-actions-webex-bridge" --query "[0].appId" -o tsv)

# Create new one
az ad sp create-for-rbac --name "github-actions-webex-bridge" --role contributor --scopes /subscriptions/$(az account show --query id -o tsv) --sdk-auth
```

### Error: "Resource group not found"

The workflow will auto-create the resource group on first run. Ensure the service principal has subscription-level contributor access.

### Error: "Permission denied to push to ghcr.io"

**Solution:** Enable package write permissions:
1. Go to repository **Settings** → **Actions** → **General**
2. Under **Workflow permissions**, select **Read and write permissions**
3. Save

### View Workflow Logs

1. Go to: https://github.com/YOUR_USERNAME/Led-Matrix-Webex/actions
2. Click on the failed workflow run
3. Click on the failed job
4. Expand the failed step

## Cost Impact

The automated deployment adds no extra cost:
- ✅ GitHub Actions: Free for public repos (2000 minutes/month for private)
- ✅ GitHub Container Registry: Free unlimited public packages
- ✅ Azure resources: Same cost as manual deployment (~$17/month)

## Security Best Practices

1. **Service Principal Scope:** The service principal only has access to the `webex-bridge-rg` resource group
2. **Credential Rotation:** Rotate service principal credentials every 90 days
3. **Minimal Permissions:** Only `contributor` role on resource group
4. **Secret Scanning:** GitHub automatically scans for leaked secrets

## Monitoring Deployments

After each deployment:
1. Check **Actions** tab for build/deploy status
2. View deployment summary in the workflow run
3. Azure IP address is shown in the summary
4. Update Cloudflare DNS if IP changed

## Manual Deployment (Fallback)

If GitHub Actions is unavailable, you can still deploy manually:
```bash
cd bridge
./azure-deploy.sh
```
