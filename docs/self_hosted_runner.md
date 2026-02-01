 # Self-Hosted GitHub Actions Runner
 
 This repository is configured to run all GitHub Actions workflows on a
 self-hosted runner using the `self-hosted` label.
 
 ## Why this matters
 
 If no self-hosted runner is registered and online, workflows will remain
 queued and appear to "fail" by never starting. This blocks CI/CD for:
 - Firmware builds and releases
 - Website deploys
 - Azure deployments
 - Scheduled maintenance jobs
 
 ## Supported OS
 
 The workflows assume a Linux runner with Docker support. A tested baseline is:
 - Ubuntu 22.04 or 24.04
 - x64 architecture
 
 ## Required runner labels
 
 The workflows use:
 - `runs-on: self-hosted`
 
 Optional (recommended) labels you can add to your runner:
 - `linux`
 - `x64`
 
 If you add labels, you can update workflows to:
 ```yaml
 runs-on: [self-hosted, linux, x64]
 ```
 
 ## Register a self-hosted runner (repo-level)
 
 1. Go to GitHub repo settings:
    - `Settings` → `Actions` → `Runners` → `New self-hosted runner`
 2. Select **Linux** and follow the displayed installation steps.
 3. Ensure the runner service is running and online.
 
 ## Required tooling on the runner
 
 Install these dependencies on the runner host:
 
 ### Core build tools
 - `git`
 - `curl`
 - `jq`
 - `zip`
 - `python3` (3.11)
 - `node` (20.x)
 - `npm`
 - `pip`
 
 ### Firmware build tooling
 - `platformio` (installed by workflow)
 - `esptool` (installed by workflow)
 
 ### Docker build tooling
 - Docker Engine
 - Buildx (installed by workflow action)
 
 ### Azure deployment tooling
 - `az` CLI (Azure CLI)
 
 ### Cloudflare deploy tooling
 - `wrangler` (installed by workflow via `npx`)
 
 ## Required GitHub secrets and vars
 
 These workflows expect secrets/vars to be configured in GitHub:
 
 **Secrets**
 - `WEBEX_CLIENT_ID`
 - `WEBEX_CLIENT_SECRET`
 - `SUPABASE_URL`
 - `SUPABASE_SERVICE_ROLE_KEY`
 - `NEXT_PUBLIC_SUPABASE_URL`
 - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
 - `CLOUDFLARE_API_TOKEN`
 - `CLOUDFLARE_ACCOUNT_ID`
 - `AZURE_CREDENTIALS`
 
 **Variables**
 - `SUPABASE_URL` (for scheduled cleanup)
 
 ## Verify runner health
 
 - In GitHub: `Settings` → `Actions` → `Runners`
 - Ensure status shows **Idle** or **Running**, not **Offline**
 - Keep the runner online for scheduled workflows
 
