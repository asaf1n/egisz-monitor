#!/bin/bash
# build-and-push.sh
# Build script with versioning for egisz-monitor project
# Usage: ./build-and-push.sh backend 1.1.0

set -e

SERVICE=$1
VERSION=${2:-dev}
REGISTRY=${REGISTRY:-localhost}
BUILD_DATE=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
COMMIT_SHA=$(git rev-parse --short HEAD 2>/dev/null || echo "unknown")

if [ -z "$SERVICE" ]; then
  echo "Usage: $0 <backend|frontend> [version]"
  exit 1
fi

echo "================================"
echo "Building: $SERVICE v$VERSION"
echo "Registry: $REGISTRY"
echo "Build Date: $BUILD_DATE"
echo "Commit: $COMMIT_SHA"
echo "================================"

# Build backend
if [ "$SERVICE" = "backend" ] || [ "$SERVICE" = "all" ]; then
  echo "[1/3] Building backend image..."
  docker build \
    --progress=plain \
    --build-arg VERSION="$VERSION" \
    --build-arg BUILD_DATE="$BUILD_DATE" \
    --build-arg COMMIT_SHA="$COMMIT_SHA" \
    -t "$REGISTRY/egisz-backend:$VERSION" \
    -t "$REGISTRY/egisz-backend:$VERSION-$BUILD_DATE" \
    -t "$REGISTRY/egisz-backend:sha-$COMMIT_SHA" \
    -t "$REGISTRY/egisz-backend:latest" \
    -f backend/Dockerfile \
    backend/
  
  echo "[1/3] Backend image built successfully"
  echo "  → $REGISTRY/egisz-backend:$VERSION"
fi

# Build frontend
if [ "$SERVICE" = "frontend" ] || [ "$SERVICE" = "all" ]; then
  echo "[2/3] Building frontend image..."
  docker build \
    --progress=plain \
    --build-arg VERSION="$VERSION" \
    --build-arg BUILD_DATE="$BUILD_DATE" \
    --build-arg COMMIT_SHA="$COMMIT_SHA" \
    -t "$REGISTRY/egisz-frontend:$VERSION" \
    -t "$REGISTRY/egisz-frontend:$VERSION-$BUILD_DATE" \
    -t "$REGISTRY/egisz-frontend:sha-$COMMIT_SHA" \
    -t "$REGISTRY/egisz-frontend:latest" \
    -f frontend/Dockerfile \
    frontend/
  
  echo "[2/3] Frontend image built successfully"
  echo "  → $REGISTRY/egisz-frontend:$VERSION"
fi

# Inspect images
echo "[3/3] Image information:"
docker image ls --filter "reference=$REGISTRY/egisz-*:$VERSION" --format "table {{.Repository}}\t{{.Tag}}\t{{.Size}}"

echo ""
echo "✓ Build complete"
echo ""
echo "Next steps:"
echo "  1. Test: docker run -it $REGISTRY/egisz-backend:$VERSION"
echo "  2. Push: docker push $REGISTRY/egisz-backend:$VERSION"
echo "  3. Deploy: Update docker-compose.yml with tag '$VERSION'"
