# Self-Hosted GitHub Actions Runners

This directory contains a Docker Compose configuration to run 7 parallel GitHub Actions runners.

## Prerequisites

- Docker and Docker Compose installed
- A GitHub Personal Access Token (PAT) with `repo` scope

## Setup

### 1. Create a Personal Access Token

1. Go to GitHub → Settings → Developer settings → Personal access tokens → Tokens (classic)
2. Click "Generate new token (classic)"
3. Give it a name like "LED Matrix Runners"
4. Select the `repo` scope (full control of private repositories)
5. **Set expiration to "No expiration"** for persistent runners
6. Click "Generate token"
7. Copy the token (you won't see it again!)

### 2. Configure and Start

```bash
cd .github/docker/runners

# Create .env file from template
cp .env.example .env

# Edit and add your PAT
nano .env

# Start all 7 runners (docker-compose reads .env automatically)
docker-compose up -d

# Check status
docker-compose ps
```

Docker Compose automatically reads `.env` from the same directory - no environment variables or scripts needed.

### 4. Verify Registration

Go to your repo: **Settings → Actions → Runners**

You should see 7 runners with status "Idle":
- docker-runner-1 through docker-runner-7

## Auto-Start on Reboot

The containers use `restart: always`, so they automatically restart when:
- Docker daemon restarts
- System reboots

Just ensure Docker starts on boot (usually enabled by default):

```bash
sudo systemctl enable docker
```

That's it - runners will come back up after any reboot.

## Networking

The runners use a dedicated bridge network (`172.28.0.0/16`) with:
- Outbound internet access to GitHub API
- Docker socket mount for spawning job containers (sibling containers)

## Management

```bash
# Stop all runners
docker-compose down

# Restart runners
docker-compose restart

# View logs for specific runner
docker-compose logs runner-3

# Update runner images
docker-compose pull
docker-compose up -d
```

## Resource Usage

Each runner container uses approximately:
- **Memory**: 500MB - 2GB (depending on job)
- **CPU**: Variable based on job workload

For a host running all 7 runners simultaneously:
- **Recommended RAM**: 16GB+
- **Recommended CPU**: 8+ cores

## Troubleshooting

### Runners show as "Offline"

1. Check if containers are running: `docker-compose ps`
2. Check logs: `docker-compose logs`
3. Verify PAT hasn't expired
4. Ensure Docker socket is accessible

### Jobs fail with permission errors

The runners mount the Docker socket to run container jobs. Ensure:
- Docker socket exists at `/var/run/docker.sock`
- Current user has Docker permissions

### Containers don't start after reboot

```bash
# Check Docker is enabled
sudo systemctl is-enabled docker

# Enable if not
sudo systemctl enable docker
```

### Token expired

Update your `.env` file with a new PAT and restart:

```bash
nano .env  # Update GITHUB_PAT
docker-compose down
docker-compose up -d
```

## Security Notes

- The PAT grants repo access - keep it secret
- The `.env` file is gitignored - never commit it
- Consider using GitHub's fine-grained tokens for tighter permissions
- Runners have access to the host's Docker daemon via socket mount
