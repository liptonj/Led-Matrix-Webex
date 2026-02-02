FROM ubuntu:22.04

# LED Matrix Webex - CI/CD Build Container
# Contains all tools needed for firmware and website builds
#
# Build from repo root: docker build -f .github/docker/Dockerfile -t led-matrix-builder:latest .
# Push: docker push ghcr.io/liptonj/led-matrix-builder:latest

LABEL maintainer="liptonj"
LABEL description="Build container for LED Matrix Webex project"

# Prevent interactive prompts during package installation
ENV DEBIAN_FRONTEND=noninteractive

# Set up locales
RUN apt-get update && apt-get install -y locales && \
    locale-gen en_US.UTF-8 && \
    update-locale LANG=en_US.UTF-8

ENV LANG=en_US.UTF-8
ENV LC_ALL=en_US.UTF-8

# =============================================================================
# System Dependencies
# =============================================================================
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    g++ \
    gcc \
    make \
    cmake \
    python3 \
    python3-pip \
    python3-venv \
    python3-dev \
    git \
    curl \
    wget \
    jq \
    zip \
    unzip \
    ca-certificates \
    gnupg \
    libffi-dev \
    libssl-dev \
    && rm -rf /var/lib/apt/lists/*

# =============================================================================
# Node.js 20.x (for website builds)
# =============================================================================
RUN curl -fsSL https://deb.nodesource.com/setup_20.x | bash - && \
    apt-get install -y nodejs && \
    rm -rf /var/lib/apt/lists/*

# Verify Node.js installation
RUN node --version && npm --version

# =============================================================================
# Python Setup (for PlatformIO and scripts)
# =============================================================================
RUN ln -sf /usr/bin/python3 /usr/bin/python

# Upgrade pip
RUN python -m pip install --upgrade pip setuptools wheel

# =============================================================================
# PlatformIO (for firmware builds)
# =============================================================================
RUN pip install --no-cache-dir \
    platformio \
    esptool \
    ruff \
    mypy \
    pylint

# Pre-install ESP32 platform and common libraries to speed up builds
RUN platformio platform install espressif32 && \
    platformio platform install native

# Verify PlatformIO installation
RUN pio --version

# =============================================================================
# Wrangler CLI (for Cloudflare Pages deployment)
# =============================================================================
RUN npm install -g wrangler typescript

# =============================================================================
# Pre-install Project Dependencies
# =============================================================================
# Copy package.json files for npm ci caching
COPY website/package.json website/package-lock.json /tmp/website/
COPY bridge/package.json bridge/package-lock.json /tmp/bridge/

# Install website dependencies
WORKDIR /tmp/website
RUN npm ci && \
    # Copy node_modules to a cache location
    mkdir -p /opt/node_modules_cache/website && \
    mv node_modules /opt/node_modules_cache/website/

# Install bridge dependencies
WORKDIR /tmp/bridge
RUN npm ci && \
    mkdir -p /opt/node_modules_cache/bridge && \
    mv node_modules /opt/node_modules_cache/bridge/

# Cleanup
RUN rm -rf /tmp/website /tmp/bridge

# =============================================================================
# Pre-install Firmware Libraries
# =============================================================================
# Copy platformio.ini to pre-install libraries
COPY firmware/platformio.ini /tmp/firmware/platformio.ini

WORKDIR /tmp/firmware
# Create minimal src file for library resolution
RUN mkdir -p src && echo "void setup(){} void loop(){}" > src/main.cpp && \
    # Install libraries for esp32s3 environment
    pio pkg install -e esp32s3 || true && \
    # Cleanup
    rm -rf /tmp/firmware

# =============================================================================
# Environment Setup
# =============================================================================
ENV PLATFORMIO_CORE_DIR=/root/.platformio
ENV HOME=/root
ENV PATH="/root/.local/bin:${PATH}"

WORKDIR /workspace

# =============================================================================
# Helper script to restore cached node_modules
# =============================================================================
RUN echo '#!/bin/bash\n\
if [ -d "/opt/node_modules_cache/website" ] && [ ! -d "website/node_modules" ]; then\n\
  echo "Restoring website node_modules from cache..."\n\
  cp -r /opt/node_modules_cache/website/node_modules website/\n\
fi\n\
if [ -d "/opt/node_modules_cache/bridge" ] && [ ! -d "bridge/node_modules" ]; then\n\
  echo "Restoring bridge node_modules from cache..."\n\
  cp -r /opt/node_modules_cache/bridge/node_modules bridge/\n\
fi\n\
' > /usr/local/bin/restore-node-modules && chmod +x /usr/local/bin/restore-node-modules

# =============================================================================
# Deno (for Supabase Edge Functions tests)
# =============================================================================
RUN curl -fsSL https://deno.land/install.sh | sh && \
    mv /root/.deno/bin/deno /usr/local/bin/

# =============================================================================
# GitHub Actions Runner Support (for self-hosted runner containers)
# =============================================================================
# Install dependencies required by GitHub Actions Runner
RUN apt-get update && apt-get install -y --no-install-recommends \
    libicu70 \
    libssl3 \
    && rm -rf /var/lib/apt/lists/*

# Download and install GitHub Actions Runner
ARG RUNNER_VERSION="2.321.0"
RUN mkdir -p /actions-runner && cd /actions-runner && \
    curl -o actions-runner-linux-x64-${RUNNER_VERSION}.tar.gz \
      -L https://github.com/actions/runner/releases/download/v${RUNNER_VERSION}/actions-runner-linux-x64-${RUNNER_VERSION}.tar.gz && \
    tar xzf ./actions-runner-linux-x64-${RUNNER_VERSION}.tar.gz && \
    rm actions-runner-linux-x64-${RUNNER_VERSION}.tar.gz

# Install runner dependencies
RUN cd /actions-runner && ./bin/installdependencies.sh

# Create entrypoint script for runner
RUN echo '#!/bin/bash\n\
set -e\n\
\n\
# Configuration\n\
RUNNER_NAME=${RUNNER_NAME:-"docker-runner"}\n\
REPO_URL=${REPO_URL:-""}\n\
ACCESS_TOKEN=${ACCESS_TOKEN:-""}\n\
LABELS=${LABELS:-"self-hosted,linux,x64,docker"}\n\
RUNNER_WORKDIR=${RUNNER_WORKDIR:-"/tmp/github-runner"}\n\
RUNNER_SCOPE=${RUNNER_SCOPE:-"repo"}\n\
RUN_AS_ROOT=${RUN_AS_ROOT:-"false"}\n\
\n\
# Allow running as root if RUN_AS_ROOT is set\n\
if [ "$RUN_AS_ROOT" = "true" ] || [ "$RUN_AS_ROOT" = "1" ]; then\n\
  export RUNNER_ALLOW_RUNASROOT=1\n\
  echo "Running as root (RUNNER_ALLOW_RUNASROOT=1)"\n\
fi\n\
\n\
if [ -z "$REPO_URL" ] || [ -z "$ACCESS_TOKEN" ]; then\n\
  echo "ERROR: REPO_URL and ACCESS_TOKEN must be set"\n\
  exit 1\n\
fi\n\
\n\
cd /actions-runner\n\
\n\
# Cleanup any previous registration\n\
./config.sh remove --token "$ACCESS_TOKEN" 2>/dev/null || true\n\
\n\
# Configure runner\n\
./config.sh \\\n\
  --url "$REPO_URL" \\\n\
  --token "$ACCESS_TOKEN" \\\n\
  --name "$RUNNER_NAME" \\\n\
  --work "$RUNNER_WORKDIR" \\\n\
  --labels "$LABELS" \\\n\
  --unattended \\\n\
  --replace\n\
\n\
# Cleanup function\n\
cleanup() {\n\
  echo "Removing runner..."\n\
  ./config.sh remove --token "$ACCESS_TOKEN"\n\
}\n\
\n\
trap cleanup EXIT\n\
\n\
# Run the runner\n\
./run.sh\n\
' > /entrypoint-runner.sh && chmod +x /entrypoint-runner.sh

WORKDIR /actions-runner

# =============================================================================
# Health Check
# =============================================================================
RUN echo "=== Build Environment ===" && \
    echo "Python: $(python --version)" && \
    echo "Node.js: $(node --version)" && \
    echo "npm: $(npm --version)" && \
    echo "PlatformIO: $(pio --version)" && \
    echo "Deno: $(deno --version | head -1)" && \
    echo "g++: $(g++ --version | head -1)" && \
    echo "git: $(git --version)" && \
    echo "wrangler: $(wrangler --version 2>/dev/null || echo 'installed')" && \
    echo "Cached node_modules: $(du -sh /opt/node_modules_cache 2>/dev/null || echo 'none')" && \
    echo "GitHub Runner: installed at /actions-runner" && \
    echo "========================="

# Default: Run as build container (bash)
# Override entrypoint for runner mode: --entrypoint /entrypoint-runner.sh
CMD ["/bin/bash"]
