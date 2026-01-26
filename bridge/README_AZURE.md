# Azure Bridge Deployment - Complete Guide

Deploy your Webex Bridge to Azure Container Instances with GitHub Actions CI/CD.

## 📊 Quick Overview

| Feature | Details |
|---------|---------|
| **Cost** | ~$17/month (covered by $100 Azure credit) |
| **Uptime** | 99.9% SLA |
| **Deployment** | Automated via GitHub Actions |
| **Registry** | GitHub Container Registry (free) |
| **SSL** | Cloudflare (free) |
| **Access** | Global via `wss://bridge.5ls.us` |

## 🚀 Quick Start (5 minutes)

### 1. Install Azure CLI

```bash
cd bridge
./install-azure-cli.sh
```

### 2. Login to Azure

```bash
az login
```

### 3. Setup GitHub Actions (Automated Deployment)

```bash
./setup-github-actions.sh
```

This will:
- Create Azure service principal
- Add `AZURE_CREDENTIALS` secret to GitHub
- Enable automatic deployments on push to `main`

### 4. Push to Deploy

```bash
git add .
git commit -m "feat: deploy bridge to Azure"
git push origin main
```

GitHub Actions will automatically:
- ✅ Build Docker image
- ✅ Push to GitHub Container Registry
- ✅ Deploy to Azure
- ✅ Run health checks

### 5. Configure Cloudflare DNS

After deployment completes, check the GitHub Actions summary for the Azure IP, then:

1. Go to Cloudflare DNS for `5ls.us`
2. Add A record: `bridge` → `<Azure IP>`
3. Enable proxy (orange cloud)
4. Wait 2-3 minutes for DNS propagation

### 6. Update Bridge Config

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
  }
}
```

## 📖 Deployment Options

### Option 1: Automated (CI/CD) ⭐ Recommended

**Triggers:**
- Push to `main` (changes in `bridge/`)
- Manual workflow dispatch
- New release published

**Advantages:**
- ✅ Fully automated
- ✅ Tested on every commit
- ✅ No local Docker/Azure setup needed
- ✅ Build logs in GitHub Actions

**Cost:** $0 extra (GitHub Actions free for public repos)

### Option 2: Manual Deployment

```bash
cd bridge
export GITHUB_USER=liptonj
export GITHUB_TOKEN=ghp_your_token_here
./azure-deploy.sh
```

**When to use:**
- First-time setup
- Testing before enabling CI/CD
- GitHub Actions unavailable

## 📁 Project Structure

```
bridge/
├── azure-deploy.sh              # Manual deployment script
├── setup-github-actions.sh      # Setup CI/CD automation
├── install-azure-cli.sh         # Install Azure CLI
├── pre-deployment-check.sh      # Verify prerequisites
├── azure-cost-estimate.js       # Cost calculator
├── Dockerfile.azure             # Production Docker image
├── .dockerignore               # Docker build exclusions
├── AZURE.md                    # Quick reference
└── src/                        # Bridge server source

.github/workflows/
├── deploy-bridge-azure.yml     # CI/CD workflow
└── AZURE_SECRETS_SETUP.md      # Secrets documentation

docs/
├── azure_deployment.md         # Full manual deployment guide
└── azure_ci_cd.md             # CI/CD overview
```

## 💰 Cost Breakdown

Run cost estimator:
```bash
node bridge/azure-cost-estimate.js
```

| Resource | Cost/Month | Notes |
|----------|------------|-------|
| Container Instance (0.5 vCPU, 0.5 GB) | ~$17 | Runs 24/7 |
| GitHub Container Registry | $0 | Free unlimited public |
| Azure File Storage (1 GB) | $0.05 | Persistent data |
| **Total** | **~$17** | Covered by $100 credit |

**Azure Free Tier:**
- 240 vCPU-seconds/day FREE
- 360,000 GB-seconds/month FREE

With free tier applied, your actual cost may be even lower!

## 🔧 Commands

### View Logs

```bash
az container logs \
  --resource-group webex-bridge-rg \
  --name webex-bridge \
  --follow
```

### Check Status

```bash
az container show \
  --resource-group webex-bridge-rg \
  --name webex-bridge \
  --query "instanceView.state"
```

### Restart Container

```bash
az container restart \
  --resource-group webex-bridge-rg \
  --name webex-bridge
```

### Get IP Address

```bash
az container show \
  --resource-group webex-bridge-rg \
  --name webex-bridge \
  --query "ipAddress.ip" -o tsv
```

### Delete Everything

```bash
az group delete --name webex-bridge-rg --yes
```

## 🧪 Testing

### Test WebSocket Connection

```bash
# Install wscat
npm install -g wscat

# Test cloud bridge
wscat -c wss://bridge.5ls.us
```

### Test Direct Azure Connection

```bash
# Get IP
AZURE_IP=$(az container show \
  --resource-group webex-bridge-rg \
  --name webex-bridge \
  --query "ipAddress.ip" -o tsv)

# Test
wscat -c ws://$AZURE_IP:8080
```

## 📊 Monitoring

### GitHub Actions

- **Workflows:** https://github.com/YOUR_USERNAME/Led-Matrix-Webex/actions
- **Container Registry:** https://github.com/YOUR_USERNAME/Led-Matrix-Webex/pkgs/container/webex-bridge

### Azure Portal

- **Resource Group:** https://portal.azure.com → webex-bridge-rg
- **Container:** webex-bridge
- **Metrics:** CPU, Memory, Network

### Logs

```bash
# Live logs
az container logs \
  --resource-group webex-bridge-rg \
  --name webex-bridge \
  --follow

# Last 100 lines
az container logs \
  --resource-group webex-bridge-rg \
  --name webex-bridge \
  --tail 100
```

## 🔒 Security

### Service Principal

- **Scope:** Limited to `webex-bridge-rg` resource group
- **Role:** Contributor (minimal required permissions)
- **Rotation:** Recommended every 90 days

```bash
# Rotate credentials
./setup-github-actions.sh
```

### Container Registry

- **Visibility:** Public (change to private for production)
- **Authentication:** GitHub token (auto-managed)

To make private:
1. Go to: https://github.com/YOUR_USERNAME/Led-Matrix-Webex/pkgs/container/webex-bridge/settings
2. Change visibility to Private
3. Update workflow to pass registry credentials

### Cloudflare

Recommended settings:
- ✅ SSL/TLS: Full
- ✅ Always Use HTTPS: On
- ✅ Minimum TLS: 1.2
- ✅ Proxy (orange cloud): On

## 🐛 Troubleshooting

### Deployment Fails: "Authentication failed"

**Solution:**
```bash
cd bridge
./setup-github-actions.sh
```

### Workflow Doesn't Trigger

**Check:**
1. Changes are in `bridge/` directory
2. Pushed to `main` branch
3. Workflow file is in `.github/workflows/`

### Container Not Starting

**Check logs:**
```bash
az container logs --resource-group webex-bridge-rg --name webex-bridge
```

**Common issues:**
- Port 8080 in use (shouldn't happen in Azure)
- Missing environment variables
- Out of memory (increase to 1GB)

### ESP32 Can't Connect

**Verify:**
1. Cloudflare DNS propagated: `nslookup bridge.5ls.us`
2. Container is running: `az container show ...`
3. Cloudflare proxy enabled (orange cloud)
4. SSL/TLS mode: Full

## 📚 Additional Documentation

- **Quick Reference:** [bridge/AZURE.md](./AZURE.md)
- **Manual Deployment:** [docs/azure_deployment.md](../docs/azure_deployment.md)
- **CI/CD Overview:** [docs/azure_ci_cd.md](../docs/azure_ci_cd.md)
- **Secrets Setup:** [.github/workflows/AZURE_SECRETS_SETUP.md](../.github/workflows/AZURE_SECRETS_SETUP.md)

## 🎯 Hybrid Setup (Recommended)

Run both Azure (cloud) and Home Assistant (local) for maximum reliability:

**Azure (Primary):**
- Global access
- 99.9% uptime
- SSL via Cloudflare

**Home Assistant (Fallback):**
- Local network
- Works during internet outages
- mDNS discovery

**Configuration:**
```json
{
  "bridge": {
    "url": "wss://bridge.5ls.us",
    "fallback_url": "ws://homeassistant.local:8080"
  }
}
```

ESP32 devices automatically fail over if cloud is unavailable!

## 💡 Tips

1. **Monitor costs:** https://portal.azure.com → Cost Management
2. **Set budget alerts:** Notify at $10, $15, $20
3. **Use tags:** Tag resources for easy cost tracking
4. **Scale down for testing:** 0.25 vCPU, 0.25 GB = ~$9/month
5. **Stop when not needed:** `az container stop ...` (pays only when running)

## 🆘 Support

- **GitHub Issues:** https://github.com/YOUR_USERNAME/Led-Matrix-Webex/issues
- **Azure Support:** https://azure.microsoft.com/support/
- **GitHub Actions:** https://docs.github.com/actions

---

**Ready to deploy?** Run `./bridge/setup-github-actions.sh` to get started!
