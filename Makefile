.PHONY: help build push deploy clean version

# ============================================================================
# EGISZ-Monitor Build & Deployment Makefile
# ============================================================================

VERSION ?= 1.1.0
REGISTRY ?= localhost:5000
COMMIT_SHA := $(shell git rev-parse --short HEAD 2>/dev/null || echo "dev")
BUILD_DATE := $(shell date -u +"%Y-%m-%dT%H:%M:%SZ")

BACKEND_IMAGE := $(REGISTRY)/egisz-backend:$(VERSION)
FRONTEND_IMAGE := $(REGISTRY)/egisz-frontend:$(VERSION)

help:
	@echo "EGISZ-Monitor Build Targets"
	@echo "=============================="
	@echo "  make build          - Build backend and frontend images"
	@echo "  make build-backend  - Build backend only"
	@echo "  make build-frontend - Build frontend only"
	@echo "  make push           - Push images to registry"
	@echo "  make deploy         - Deploy stack (requires docker swarm or compose)"
	@echo "  make version        - Display version info"
	@echo "  make clean          - Remove local images"
	@echo ""
	@echo "Environment variables:"
	@echo "  VERSION=1.1.0       (default: 1.1.0)"
	@echo "  REGISTRY=localhost  (default: localhost:5000)"

version:
	@echo "Version: $(VERSION)"
	@echo "Commit: $(COMMIT_SHA)"
	@echo "Build Date: $(BUILD_DATE)"
	@echo "Registry: $(REGISTRY)"

build: build-backend build-frontend
	@echo "✓ All images built successfully"
	@docker image ls --filter "reference=$(REGISTRY)/egisz-*:$(VERSION)" --format "table {{.Repository}}\t{{.Tag}}\t{{.Size}}"

build-backend:
	@echo "[1/2] Building backend v$(VERSION)..."
	docker build \
		--progress=plain \
		--build-arg VERSION="$(VERSION)" \
		--build-arg BUILD_DATE="$(BUILD_DATE)" \
		--build-arg COMMIT_SHA="$(COMMIT_SHA)" \
		-t "$(BACKEND_IMAGE)" \
		-t "$(REGISTRY)/egisz-backend:sha-$(COMMIT_SHA)" \
		-t "$(REGISTRY)/egisz-backend:latest" \
		-f backend/Dockerfile \
		backend/
	@echo "✓ Backend image built"

build-frontend:
	@echo "[2/2] Building frontend v$(VERSION)..."
	docker build \
		--progress=plain \
		--build-arg VERSION="$(VERSION)" \
		--build-arg BUILD_DATE="$(BUILD_DATE)" \
		--build-arg COMMIT_SHA="$(COMMIT_SHA)" \
		-t "$(FRONTEND_IMAGE)" \
		-t "$(REGISTRY)/egisz-frontend:sha-$(COMMIT_SHA)" \
		-t "$(REGISTRY)/egisz-frontend:latest" \
		-f frontend/Dockerfile \
		frontend/
	@echo "✓ Frontend image built"

push: push-backend push-frontend
	@echo "✓ All images pushed"

push-backend:
	@echo "Pushing backend to $(REGISTRY)..."
	docker push "$(BACKEND_IMAGE)"
	docker push "$(REGISTRY)/egisz-backend:sha-$(COMMIT_SHA)"

push-frontend:
	@echo "Pushing frontend to $(REGISTRY)..."
	docker push "$(FRONTEND_IMAGE)"
	docker push "$(REGISTRY)/egisz-frontend:sha-$(COMMIT_SHA)"

scan-backend:
	@echo "Scanning backend image for vulnerabilities..."
	docker scan "$(BACKEND_IMAGE)" || true

scan-frontend:
	@echo "Scanning frontend image for vulnerabilities..."
	docker scan "$(FRONTEND_IMAGE)" || true

deploy: build
	@echo "Deploying with docker compose..."
	BACKEND_VERSION=$(VERSION) FRONTEND_VERSION=$(VERSION) docker compose -f docker-compose.prod.yml up -d
	@echo "✓ Stack deployed"
	@docker compose -f docker-compose.prod.yml ps

clean:
	@echo "Removing images..."
	docker rmi -f $(BACKEND_IMAGE) $(FRONTEND_IMAGE) 2>/dev/null || true
	@echo "✓ Cleaned"

test-backend:
	@echo "Running backend container tests..."
	docker run --rm $(BACKEND_IMAGE) node --version
	docker run --rm $(BACKEND_IMAGE) npm --version

test-frontend:
	@echo "Testing frontend image..."
	docker run --rm $(FRONTEND_IMAGE) nginx -v

logs:
	docker compose -f docker-compose.prod.yml logs -f

stop:
	docker compose -f docker-compose.prod.yml stop

down:
	docker compose -f docker-compose.prod.yml down -v
