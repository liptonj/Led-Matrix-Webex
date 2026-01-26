# Azure Bridge Deployment - Quick Reference

## 🚀 Deployment Options

### Option 1: Automated (CI/CD) ⭐ Recommended

Push to main branch - GitHub Actions automatically deploys to Azure:

```bash
git add .
git commit -m "feat: update bridge"
git push origin main
```

**Setup:** See [.github/workflows/AZURE_SECRETS_SETUP.md](../.github/workflows/AZURE_SECRETS_SETUP.md)

### Option 2: Manual Deploy

```bash
cd bridge
./azure-deploy.sh
```

## 📋 Cloudflare DNS Setup

After deployment:

1. **Get IP Address** from deploy script output
2. **Add A Record** in Cloudflare:
   - Name: `bridge`
   - IPv4: `<Azure IP>`
   - Proxy: ✅ Enabled (orange cloud)
3. **Wait 2-3 minutes** for DNS propagation

## ✅ Test Connection

```bash
wscat -c wss://bridge.5ls.us
```

## 💰 Cost Estimate

- **Container**: ~$3-5/month (0.5 vCPU, 0.5 GB)
- **Registry**: ~$5/month
- **Storage**: ~$0.05/month
- **Total**: **$8-10/month** (covered by $100 Azure credit)

## 🔧 Common Commands

```bash
# View logs
az container logs --resource-group webex-bridge-rg --name webex-bridge --follow

# Restart
az container restart --resource-group webex-bridge-rg --name webex-bridge

# Check status
az container show --resource-group webex-bridge-rg --name webex-bridge --query "instanceView.state"

# Delete everything
az group delete --name webex-bridge-rg --yes
```

## 📖 Full Documentation

See [azure_deployment.md](../docs/azure_deployment.md) for complete guide.
