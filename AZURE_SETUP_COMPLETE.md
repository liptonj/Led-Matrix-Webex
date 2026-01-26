# ✅ Azure CI/CD Setup Complete!

## What We've Done

✅ **Azure Service Principal Created**
- Name: `github-actions-webex-bridge`
- Scope: Subscription level
- Role: Contributor
- Client ID: `e675d48d-81e8-4b9c-beb7-781f882cfd0b`

✅ **GitHub Secret Added**
- Secret name: `AZURE_CREDENTIALS`
- Contains: Azure service principal JSON credentials
- Added to: https://github.com/liptonj/Led-Matrix-Webex

✅ **Credentials Secured**
- Local `azure-credentials.json` file deleted
- Credentials only stored in GitHub Secrets (encrypted)

✅ **GitHub Actions Workflow Created**
- File: `.github/workflows/deploy-bridge-azure.yml`
- Triggers on: Push to `main` (changes in `bridge/`)
- Also: Manual trigger, releases

## Next Steps

### 1. Enable Workflow Permissions (Required!)

Go to: **https://github.com/liptonj/Led-Matrix-Webex/settings/actions**

- Scroll to **Workflow permissions**
- Select: ☑️ **Read and write permissions**
- Click **Save**

This allows the workflow to push Docker images to GitHub Container Registry.

### 2. Test the CI/CD Pipeline

#### Option A: Push to Main (Automatic Deployment)

```bash
cd /Users/jolipton/Projects/Led-Matrix-Webex

# Commit the new CI/CD files
git add .github/workflows/deploy-bridge-azure.yml
git add bridge/
git add docs/azure_*.md
git commit -m "feat: add Azure CI/CD deployment"

# Push to trigger deployment
git push origin main
```

#### Option B: Manual Trigger (Test First)

1. Go to: https://github.com/liptonj/Led-Matrix-Webex/actions/workflows/deploy-bridge-azure.yml
2. Click **Run workflow**
3. Select branch: `main`
4. Click **Run workflow** button

### 3. Monitor the Deployment

Watch the deployment progress:
- **Actions tab**: https://github.com/liptonj/Led-Matrix-Webex/actions
- The workflow will:
  1. Build Docker image (~2 min)
  2. Push to GitHub Container Registry (~1 min)
  3. Deploy to Azure (~3-5 min)
  4. Run health checks (~1 min)

**Total time**: ~7-9 minutes

### 4. Configure Cloudflare DNS

After deployment completes, the GitHub Actions summary will show the Azure IP address.

Then:
1. Go to Cloudflare DNS for `5ls.us`
2. Add **A Record**:
   - Name: `bridge`
   - IPv4: `<Azure IP from Actions summary>`
   - Proxy: ✅ Enabled (orange cloud)
   - TTL: Auto
3. Wait 2-3 minutes for DNS propagation

### 5. Update Bridge Config

Edit `website/public/api/bridge-config.json`:

```json
{
  "version": 1,
  "bridge": {
    "url": "wss://bridge.5ls.us",
    "fallback_url": "ws://homeassistant.local:8080"
  },
  "features": {
    "pairing_enabled": true
  },
  "updated_at": "2026-01-26T00:00:00Z"
}
```

Commit and push:
```bash
git add website/public/api/bridge-config.json
git commit -m "feat: update bridge URL to Azure cloud"
git push origin main
```

### 6. Test the Connection

```bash
# Install wscat if needed
npm install -g wscat

# Test cloud bridge
wscat -c wss://bridge.5ls.us
```

You should see: `Connected (press CTRL+C to quit)`

## What Happens Now (Automated Workflow)

Every time you push changes to `bridge/` on the `main` branch:

1. ✅ **Build** - Docker image built automatically
2. ✅ **Test** - Linting and tests run
3. ✅ **Push** - Image pushed to GitHub Container Registry
4. ✅ **Deploy** - Container deployed to Azure
5. ✅ **Verify** - Health checks confirm it's running
6. 📧 **Notify** - You'll get email if deployment fails

## Cost Summary

| Resource | Cost/Month |
|----------|-----------|
| GitHub Actions | $0 (free for public repos) |
| GitHub Container Registry | $0 (free unlimited public) |
| Azure Container Instance | ~$17 |
| Azure File Storage | ~$0.05 |
| **Total** | **~$17/month** |

✅ Covered by your $100/month Azure credit!

## Useful Commands

### View Deployment Logs
```bash
az container logs \
  --resource-group webex-bridge-rg \
  --name webex-bridge \
  --follow
```

### Check Container Status
```bash
az container show \
  --resource-group webex-bridge-rg \
  --name webex-bridge \
  --query "instanceView.state"
```

### Get Container IP
```bash
az container show \
  --resource-group webex-bridge-rg \
  --name webex-bridge \
  --query "ipAddress.ip" -o tsv
```

### Delete Everything (if needed)
```bash
az group delete --name webex-bridge-rg --yes
```

## Troubleshooting

### Workflow Fails: "Authentication failed"

The AZURE_CREDENTIALS secret is working! If you see this error later, re-run:
```bash
cd bridge
./setup-azure-cicd.sh
```

### Workflow Fails: "Permission denied to push to ghcr.io"

**Solution**: Enable workflow permissions (see Step 1 above)

### Container Won't Start

Check logs:
```bash
az container logs --resource-group webex-bridge-rg --name webex-bridge
```

### ESP32 Can't Connect

1. Verify DNS: `nslookup bridge.5ls.us`
2. Test directly: `wscat -c wss://bridge.5ls.us`
3. Check Cloudflare SSL/TLS mode: Should be "Full"

## Documentation

- **Quick Reference**: [bridge/AZURE.md](bridge/AZURE.md)
- **Full Manual Deploy**: [docs/azure_deployment.md](docs/azure_deployment.md)
- **CI/CD Overview**: [docs/azure_ci_cd.md](docs/azure_ci_cd.md)
- **Complete Guide**: [bridge/README_AZURE.md](bridge/README_AZURE.md)

---

**You're all set!** 🎉

Just enable workflow permissions and push to main to deploy!
