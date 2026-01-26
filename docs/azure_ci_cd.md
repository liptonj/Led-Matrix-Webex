# Azure Bridge CI/CD Summary

## What's Automated

✅ **Build** - Docker image built on every push to `bridge/`
✅ **Push** - Image pushed to GitHub Container Registry (free!)
✅ **Deploy** - Container deployed to Azure on push to `main`
✅ **Health Check** - Automatic verification after deployment
✅ **Cost** - $0 extra (GitHub Actions free for public repos)

## Workflow Triggers

| Trigger | What Happens |
|---------|--------------|
| Push to `main` (changes in `bridge/`) | Build → Push → Deploy to Azure |
| Pull Request | Build only (no deploy) |
| Release published | Build → Push → Deploy to Azure |
| Manual workflow dispatch | Build → Push → Deploy to Azure |

## Setup (One-Time)

1. **Create Azure Service Principal:**
   ```bash
   az ad sp create-for-rbac \
     --name "github-actions-webex-bridge" \
     --role contributor \
     --scopes /subscriptions/$(az account show --query id -o tsv) \
     --sdk-auth
   ```

2. **Add to GitHub Secrets:**
   - Go to: https://github.com/YOUR_USERNAME/Led-Matrix-Webex/settings/secrets/actions
   - Name: `AZURE_CREDENTIALS`
   - Value: Paste entire JSON output

3. **Enable Package Permissions:**
   - Go to: Settings → Actions → General
   - Workflow permissions: **Read and write permissions**

## View Deployments

- **GitHub Actions:** https://github.com/YOUR_USERNAME/Led-Matrix-Webex/actions
- **Container Registry:** https://github.com/YOUR_USERNAME/Led-Matrix-Webex/pkgs/container/webex-bridge
- **Azure Portal:** https://portal.azure.com → Resource Groups → webex-bridge-rg

## Cost Breakdown

| Component | Cost |
|-----------|------|
| GitHub Actions | **$0** (free for public repos) |
| GitHub Container Registry | **$0** (free unlimited public) |
| Azure Container Instance | ~$17/month |
| Azure File Storage | ~$0.05/month |
| **Total with CI/CD** | **~$17/month** |

**Savings vs Manual:**
- ❌ No Azure Container Registry ($5/month saved!)
- ⏱️ No manual deployment time (5-10 min saved per deploy)
- 🔄 Automatic deployments on every commit
- 🧪 Automatic build/test on PRs

## Monitoring

### Check Deployment Status
```bash
# View logs
az container logs \
  --resource-group webex-bridge-rg \
  --name webex-bridge \
  --follow

# Check status
az container show \
  --resource-group webex-bridge-rg \
  --name webex-bridge \
  --query "instanceView.state"
```

### GitHub Actions Summary

After each deployment, the workflow creates a summary showing:
- ✅ Build status
- 📦 Image tags pushed
- ☁️ Azure IP address
- 📋 Next steps (Cloudflare DNS)

## Troubleshooting

| Problem | Solution |
|---------|----------|
| Authentication failed | Re-create service principal (see AZURE_SECRETS_SETUP.md) |
| Push to ghcr.io denied | Enable write permissions in Actions settings |
| Container not starting | Check logs: `az container logs ...` |
| Workflow not triggering | Ensure changes are in `bridge/` directory |

## Full Documentation

- **Secrets Setup:** [.github/workflows/AZURE_SECRETS_SETUP.md](../.github/workflows/AZURE_SECRETS_SETUP.md)
- **Manual Deployment:** [docs/azure_deployment.md](../docs/azure_deployment.md)
- **Quick Reference:** [bridge/AZURE.md](./AZURE.md)
