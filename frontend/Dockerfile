# ============================================================================
# egisz-monitor-frontend Dockerfile v1.1.0
# Security: Non-root nginx user
# Optimization: Multi-stage build, minimal image (~25MB), layer caching
# ============================================================================

ARG VERSION=dev
ARG BUILD_DATE=unknown
ARG COMMIT_SHA=unknown
ARG NODE_VERSION=18

# ============================================================================
# Stage 1: Dependency resolver
# Purpose: Isolate npm install for Docker cache efficiency
FROM node:18-alpine AS deps

WORKDIR /app

# Cache key #1: package files only
COPY package*.json ./

# Install all dependencies (including devDependencies)
RUN npm ci --audit=false

# ============================================================================
# Stage 2: Builder
# Purpose: Compile TypeScript, build Vite assets
FROM node:18-alpine AS builder

ARG VERSION
ARG BUILD_DATE
ARG COMMIT_SHA

WORKDIR /app

# Copy config files (cache key #2: static configs)
# Order: config files before package.json for better caching
COPY tsconfig.json vite.config.ts tailwind.config.js postcss.config.js ./

# Copy pre-installed node_modules from deps stage
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/package*.json ./

# Copy source code (cache key #3: changes here don't invalidate npm install)
COPY src ./src
COPY index.html ./

# Build static assets with Vite
# Output directory: dist/
RUN npm run build

# Verify build output
RUN test -d dist && ls -la dist/ || (echo "Build failed"; exit 1)

# ============================================================================
# Stage 3: Runtime (Nginx)
# Purpose: Serve static assets, minimal footprint, security hardening
FROM nginx:1.27-alpine

ARG VERSION
ARG BUILD_DATE
ARG COMMIT_SHA

LABEL version="${VERSION}" \
      build.date="${BUILD_DATE}" \
      build.commit="${COMMIT_SHA}" \
      maintainer="egisz-monitor" \
      description="EGISZ Monitor Frontend Service"

# Remove default nginx config
RUN rm /etc/nginx/conf.d/default.conf

# Copy custom nginx configuration
COPY nginx.conf /etc/nginx/conf.d/

# Copy compiled static assets from builder
# Only dist/ output, no source code leakage
COPY --from=builder /app/dist /usr/share/nginx/html

# Security: Create nginx tmp directories with proper permissions
RUN mkdir -p /var/cache/nginx/client_temp && \
    chown -R nginx:nginx /var/cache/nginx && \
    chown -R nginx:nginx /var/run && \
    chown -R nginx:nginx /usr/share/nginx/html && \
    chown -R nginx:nginx /etc/nginx

# Store version metadata
RUN echo "# Version: ${VERSION} | Build Date: ${BUILD_DATE} | Commit: ${COMMIT_SHA}" > /usr/share/nginx/html/.build-info

# Healthcheck
HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://127.0.0.1:80 || exit 1

# Expose port 80 (only frontend, no management ports)
EXPOSE 80

# Runtime metadata
ENV VERSION=${VERSION} \
    BUILD_DATE=${BUILD_DATE} \
    COMMIT_SHA=${COMMIT_SHA}

# Start nginx in foreground
ENTRYPOINT ["nginx"]
CMD ["-g", "daemon off;"]
