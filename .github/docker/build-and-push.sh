#!/bin/bash
# Build and push the CI/CD container image
#
# Usage:
#   ./build-and-push.sh           # Build only
#   ./build-and-push.sh --push    # Build and push to GHCR
#
# Must be run from repo root (or script will cd there)

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
# Local image name (no registry prefix) for self-hosted runner
LOCAL_IMAGE_NAME="led-matrix-builder"
# GHCR image name for pushing to registry
GHCR_IMAGE_NAME="ghcr.io/liptonj/led-matrix-builder"
TAG="latest"

cd "${REPO_ROOT}"
echo "Building from repo root: ${REPO_ROOT}"

echo "Building Docker image: ${LOCAL_IMAGE_NAME}:${TAG}"
docker build --network=host -f .github/docker/Dockerfile -t "${LOCAL_IMAGE_NAME}:${TAG}" .

# Also tag with GHCR name for pushing
docker tag "${LOCAL_IMAGE_NAME}:${TAG}" "${GHCR_IMAGE_NAME}:${TAG}"
echo "Tagged as ${GHCR_IMAGE_NAME}:${TAG}"

# Also tag with date for versioning
DATE_TAG=$(date +%Y%m%d)
docker tag "${IMAGE_NAME}:${TAG}" "${IMAGE_NAME}:${DATE_TAG}"

echo ""
echo "Built images:"
docker images | grep led-matrix-builder

if [[ "$1" == "--push" ]]; then
    echo ""
    echo "Pushing to GitHub Container Registry..."
    echo "Make sure you're logged in: docker login ghcr.io -u USERNAME"
    
    docker push "${IMAGE_NAME}:${TAG}"
    docker push "${IMAGE_NAME}:${DATE_TAG}"
    
    echo ""
    echo "Pushed:"
    echo "  ${IMAGE_NAME}:${TAG}"
    echo "  ${IMAGE_NAME}:${DATE_TAG}"
else
    echo ""
    echo "To push: $0 --push"
    echo "First login: docker login ghcr.io -u YOUR_GITHUB_USERNAME"
fi
