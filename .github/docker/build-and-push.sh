#!/bin/bash
# Build and push the CI/CD container image
#
# Usage:
#   ./build-and-push.sh           # Build only (must be in repo or use --clone)
#   ./build-and-push.sh --push    # Build and push to GHCR
#   ./build-and-push.sh --clone   # Clone repo first, then build
#   ./build-and-push.sh --clone --push  # Clone, build, and push
#
# Environment variables:
#   REPO_URL    - Repository URL to clone (default: https://github.com/liptonj/Led-Matrix-Webex.git)
#   REPO_BRANCH - Branch to clone (default: main)
#   WORK_DIR    - Working directory for clone (default: /tmp/led-matrix-build)

set -e

# Configuration
REPO_URL="${REPO_URL:-https://github.com/liptonj/Led-Matrix-Webex.git}"
REPO_BRANCH="${REPO_BRANCH:-main}"
WORK_DIR="${WORK_DIR:-/tmp/led-matrix-build}"

# Image names
LOCAL_IMAGE_NAME="led-matrix-builder"
GHCR_IMAGE_NAME="ghcr.io/liptonj/led-matrix-builder"
TAG="latest"
DATE_TAG=$(date +%Y%m%d)

# Parse arguments
DO_PUSH=false
DO_CLONE=false
for arg in "$@"; do
    case $arg in
        --push)
            DO_PUSH=true
            ;;
        --clone)
            DO_CLONE=true
            ;;
        --help|-h)
            echo "Usage: $0 [--clone] [--push]"
            echo ""
            echo "Options:"
            echo "  --clone  Clone the repository before building"
            echo "  --push   Push the built image to GHCR"
            echo ""
            echo "Environment variables:"
            echo "  REPO_URL    - Repository URL (default: ${REPO_URL})"
            echo "  REPO_BRANCH - Branch to clone (default: ${REPO_BRANCH})"
            echo "  WORK_DIR    - Working directory (default: ${WORK_DIR})"
            exit 0
            ;;
    esac
done

# Determine repo root
if [[ "$DO_CLONE" == "true" ]]; then
    echo "Cloning repository..."
    
    # Clean up existing directory if present
    if [[ -d "${WORK_DIR}" ]]; then
        echo "Removing existing work directory: ${WORK_DIR}"
        rm -rf "${WORK_DIR}"
    fi
    
    # Clone the repository
    echo "Cloning ${REPO_URL} (branch: ${REPO_BRANCH}) to ${WORK_DIR}"
    git clone --depth 1 --branch "${REPO_BRANCH}" "${REPO_URL}" "${WORK_DIR}"
    
    REPO_ROOT="${WORK_DIR}"
else
    # Try to find repo root from script location or current directory
    SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" 2>/dev/null && pwd)" || SCRIPT_DIR=""
    
    if [[ -n "${SCRIPT_DIR}" && -f "${SCRIPT_DIR}/../../.github/docker/Dockerfile" ]]; then
        REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
    elif [[ -f ".github/docker/Dockerfile" ]]; then
        REPO_ROOT="$(pwd)"
    else
        echo "Error: Cannot find repository root."
        echo "Either run from the repo root, or use --clone to clone the repository first."
        exit 1
    fi
fi

cd "${REPO_ROOT}"
echo "Building from repo root: ${REPO_ROOT}"

# Verify Dockerfile exists
if [[ ! -f ".github/docker/Dockerfile" ]]; then
    echo "Error: Dockerfile not found at .github/docker/Dockerfile"
    exit 1
fi

echo "Building Docker image: ${LOCAL_IMAGE_NAME}:${TAG}"
docker build --network=host -f .github/docker/Dockerfile -t "${LOCAL_IMAGE_NAME}:${TAG}" .

# Tag with GHCR name for pushing
docker tag "${LOCAL_IMAGE_NAME}:${TAG}" "${GHCR_IMAGE_NAME}:${TAG}"
echo "Tagged as ${GHCR_IMAGE_NAME}:${TAG}"

# Tag with date for versioning
docker tag "${GHCR_IMAGE_NAME}:${TAG}" "${GHCR_IMAGE_NAME}:${DATE_TAG}"
echo "Tagged as ${GHCR_IMAGE_NAME}:${DATE_TAG}"

echo ""
echo "Built images:"
docker images | grep led-matrix-builder || true

if [[ "$DO_PUSH" == "true" ]]; then
    echo ""
    echo "Pushing to GitHub Container Registry..."
    echo "Make sure you're logged in: docker login ghcr.io -u USERNAME"
    
    docker push "${GHCR_IMAGE_NAME}:${TAG}"
    docker push "${GHCR_IMAGE_NAME}:${DATE_TAG}"
    
    echo ""
    echo "Pushed:"
    echo "  ${GHCR_IMAGE_NAME}:${TAG}"
    echo "  ${GHCR_IMAGE_NAME}:${DATE_TAG}"
else
    echo ""
    echo "To push: $0 --push"
    echo "First login: docker login ghcr.io -u YOUR_GITHUB_USERNAME"
fi

# Cleanup cloned repo if we cloned it
if [[ "$DO_CLONE" == "true" ]]; then
    echo ""
    echo "Cleaning up cloned repository..."
    rm -rf "${WORK_DIR}"
    echo "Done."
fi
