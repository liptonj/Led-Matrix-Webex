# Azure Deployment Guide

Deploy the Webex Bridge server to Azure Container Instances for low-cost cloud hosting.

## Cost Estimate

With Azure's pay-per-second pricing and **GitHub Container Registry (free)**:

| Resource | Specification | Monthly Cost |
|----------|--------------|--------------|
| Container Instance | 0.5 vCPU, 0.5 GB RAM | ~$17 |
| Container Registry | GitHub (free) | **$0** |
| File Storage | 1 GB | ~$0.05 |
| **Total** | | **~$17/month** |

Your $100/month Azure credit covers this **5+ months** (or more with Azure free tier applied)!

💡 **Savings**: Using GitHub Container Registry instead of Azure Container Registry saves **$5/month** ($60/year)!

## Prerequisites

1. **Azure Account** with Developer subscription ($100/month credit)
2. **Azure CLI** installed: https://aka.ms/azure-cli
3. **Docker** installed and running
4. **Cloudflare Account** for DNS management

## Quick Start

### 1. Login to Azure

```bash
az login
```

### 2. Configure Deployment

Edit `bridge/azure-deploy.sh` and change:

```bash
REGISTRY_NAME="webexbridge"  # Change to something unique globally
```

### 3. Deploy

```bash
cd bridge
./azure-deploy.sh
```

The script will:
- ✅ Create Azure Resource Group
- ✅ Create Container Registry
- ✅ Build and push Docker image
- ✅ Create persistent storage
- ✅ Deploy container instance
- ✅ Configure health checks

### 4. Configure Cloudflare DNS

After deployment completes, you'll see:

```
Container IP: 20.xxx.xxx.xxx
Container FQDN: webex-bridge-xxxx.eastus.azurecontainer.io
```

Add to Cloudflare:

1. Go to Cloudflare DNS dashboard for `5ls.us`
2. Add **A Record**:
   - **Name**: `bridge`
   - **IPv4 address**: `20.xxx.xxx.xxx` (from deployment output)
   - **Proxy status**: ✅ Proxied (orange cloud)
   - **TTL**: Auto

3. Cloudflare will automatically:
   - Provide SSL/TLS (free)
   - Enable WebSocket support
   - Add DDoS protection

### 5. Update Bridge Configuration

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

### 6. Deploy Updated Config

```bash
cd website
npm run build
npm run deploy  # Or push to your hosting
```

## Testing

### Test WebSocket Connection

```bash
# Install wscat
npm install -g wscat

# Test connection
wscat -c wss://bridge.5ls.us

# Should see:
# Connected (press CTRL+C to quit)

# Send test message
{"type": "ping"}

# Should receive pong response
```

### View Logs

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
  --query "{Status:instanceView.state,IP:ipAddress.ip,Restarts:instanceView.currentState.detailStatus}" \
  --output table
```

## Management

### Restart Container

```bash
az container restart \
  --resource-group webex-bridge-rg \
  --name webex-bridge
```

### Update Container (New Image)

```bash
# Rebuild and push image
cd bridge
docker build -f Dockerfile.azure -t webex-bridge:latest .
docker tag webex-bridge:latest <registry>.azurecr.io/webex-bridge:latest
docker push <registry>.azurecr.io/webex-bridge:latest

# Delete and recreate container
az container delete \
  --resource-group webex-bridge-rg \
  --name webex-bridge \
  --yes

# Run deploy script again (it will skip resource group creation)
./azure-deploy.sh
```

### Scale Resources

If you need more resources:

```bash
az container create \
  # ... (same as deploy script but update:)
  --cpu 1 \          # Double CPU
  --memory 1 \       # Double memory
```

Costs scale linearly: 1 vCPU + 1GB RAM ≈ $10-15/month

## Monitoring

### Azure Portal

1. Go to https://portal.azure.com
2. Navigate to **Resource Groups** → `webex-bridge-rg`
3. Click **webex-bridge** container
4. View:
   - Metrics (CPU, memory usage)
   - Logs
   - Events
   - Settings

### Container Logs

```bash
# Last 100 lines
az container logs \
  --resource-group webex-bridge-rg \
  --name webex-bridge \
  --tail 100

# Follow (real-time)
az container logs \
  --resource-group webex-bridge-rg \
  --name webex-bridge \
  --follow
```

### Metrics

```bash
az monitor metrics list \
  --resource "/subscriptions/<subscription-id>/resourceGroups/webex-bridge-rg/providers/Microsoft.ContainerInstance/containerGroups/webex-bridge" \
  --metric "CpuUsage,MemoryUsage" \
  --output table
```

## Persistent Storage

Device registrations are stored in Azure File Share:

```bash
# List devices.json
az storage file list \
  --account-name <storage-account> \
  --share-name bridgedata \
  --output table

# Download devices.json
az storage file download \
  --account-name <storage-account> \
  --share-name bridgedata \
  --path devices.json \
  --dest ./devices.json
```

## Troubleshooting

### Connection Refused

**Problem**: ESP32 can't connect to `wss://bridge.5ls.us`

**Check**:
1. Verify Cloudflare DNS is propagated:
   ```bash
   nslookup bridge.5ls.us
   # Should return Azure IP
   ```

2. Test direct connection to Azure:
   ```bash
   wscat -c ws://<container-fqdn>:8080
   ```

3. Check container logs for errors:
   ```bash
   az container logs --resource-group webex-bridge-rg --name webex-bridge
   ```

### SSL Certificate Errors on ESP32

**Problem**: ESP32 reports SSL handshake failures

**Solution**: The firmware already includes Cloudflare CA certificates (`CA_CERT_GTS_ROOT_R4` in `ca_certs.h`). Ensure:
1. ESP32 time is synced (required for SSL)
2. Cloudflare proxy is enabled (orange cloud)
3. SSL/TLS mode is "Full" in Cloudflare

### Container Keeps Restarting

**Check**:
1. View logs for errors:
   ```bash
   az container logs --resource-group webex-bridge-rg --name webex-bridge
   ```

2. Verify port 8080 is not conflicting:
   ```bash
   az container show \
     --resource-group webex-bridge-rg \
     --name webex-bridge \
     --query "ipAddress.ports"
   ```

3. Check health check status:
   ```bash
   az container show \
     --resource-group webex-bridge-rg \
     --name webex-bridge \
     --query "instanceView.currentState.detailStatus"
   ```

### High Costs

**Check**:
1. Verify CPU/Memory allocation:
   ```bash
   az container show \
     --resource-group webex-bridge-rg \
     --name webex-bridge \
     --query "containers[0].resources.requests"
   ```

2. Should be: `cpu: 0.5, memory: 0.5`

3. Monitor actual usage in Azure Portal → Metrics

## Cleanup

### Delete Everything

```bash
az group delete \
  --name webex-bridge-rg \
  --yes \
  --no-wait
```

This removes:
- Container instance
- Container registry
- Storage account
- All associated resources

## Security

### Recommendations

1. **Enable HTTPS only** in Cloudflare:
   - SSL/TLS mode: "Full"
   - Always Use HTTPS: On
   - Minimum TLS Version: 1.2

2. **Restrict access** (optional):
   - Cloudflare Firewall Rules to allow only your network
   - Rate limiting to prevent abuse

3. **Monitor logs** for suspicious activity:
   ```bash
   az container logs --resource-group webex-bridge-rg --name webex-bridge | grep -i error
   ```

4. **Rotate registry credentials** periodically:
   ```bash
   az acr credential renew \
     --name <registry-name> \
     --password-name password
   ```

## Cost Optimization

### Further Reduce Costs

1. **Use shared storage**: If you have other Azure resources, share the storage account

2. **Reduce CPU/Memory** if usage is low:
   ```bash
   # Monitor usage first:
   az monitor metrics list ... (see Monitoring section)

   # If consistently under 50%, reduce to:
   --cpu 0.25 --memory 0.25
   ```

3. **Use Azure Free Tier**:
   - First 240 vCPU-seconds/day FREE
   - First 360,000 GB-seconds/month FREE
   - Your bridge likely stays in free tier!

4. **Stop when not needed** (if testing):
   ```bash
   az container stop --resource-group webex-bridge-rg --name webex-bridge
   az container start --resource-group webex-bridge-rg --name webex-bridge
   ```

## Comparison: Azure vs Home Assistant

| Feature | Azure | Home Assistant |
|---------|-------|----------------|
| **Cost** | $8-10/month or FREE (Azure credit) | $0 (self-hosted) |
| **Uptime** | 99.9% SLA | Depends on home network |
| **Access** | Global (via Cloudflare) | Local network only* |
| **Setup** | 5 minutes | 10+ minutes |
| **mDNS** | ❌ Not available | ✅ Works |
| **SSL** | ✅ Cloudflare (free) | Manual cert setup |
| **Maintenance** | Automatic restarts | Manual |

\* Unless Home Assistant is exposed via Nabu Casa or similar

## Best Practice: Hybrid Setup

Run **both** for redundancy:

1. **Azure** (primary): `wss://bridge.5ls.us`
2. **Home Assistant** (fallback): `ws://homeassistant.local:8080`

Your firmware already supports this via `bridge-config.json`!

```json
{
  "bridge": {
    "url": "wss://bridge.5ls.us",
    "fallback_url": "ws://homeassistant.local:8080"
  }
}
```

ESP32 will:
1. Try Azure cloud bridge first (works anywhere)
2. Fall back to Home Assistant if Azure is down
3. Use mDNS discovery as last resort

## Next Steps

1. ✅ Deploy to Azure
2. ✅ Configure Cloudflare DNS
3. ✅ Update bridge-config.json
4. ✅ Test with ESP32 device
5. 📊 Monitor costs in Azure Portal
6. 🔧 Adjust resources based on usage

## Support

- **Azure Issues**: https://docs.microsoft.com/en-us/azure/container-instances/
- **Cloudflare**: https://developers.cloudflare.com/
- **Bridge Logs**: `az container logs --resource-group webex-bridge-rg --name webex-bridge --follow`
