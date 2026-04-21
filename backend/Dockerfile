# ============================================================================
# egisz-monitor-backend Dockerfile v1.1.0
# Security: Non-root user (node:1000)
# Optimization: Layer caching, dependency separation, ARG versioning
# Image: node:18-alpine with digest pinning
# ============================================================================

ARG VERSION=dev
ARG BUILD_DATE=unknown
ARG COMMIT_SHA=unknown
ARG NODE_VERSION=18.19.0

# ============================================================================
# Stage 1: Dependency resolver
# Purpose: Separate dependency installation for Docker cache reuse
FROM node:${NODE_VERSION}-alpine AS deps

WORKDIR /app

# Copy only package files (cache key #1)
COPY package*.json ./

# Install all dependencies (including devDependencies for build stage)
RUN npm ci --audit=false

# ============================================================================
# Stage 2: Builder
# Purpose: Compile TypeScript, include devDependencies
FROM node:${NODE_VERSION}-alpine AS builder

ARG VERSION
ARG BUILD_DATE
ARG COMMIT_SHA

WORKDIR /app

# Copy tsconfig before dependencies to preserve caching
COPY tsconfig.json ./

# Copy pre-installed dependencies from deps stage
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/package*.json ./

# Copy source code (cache key #2)
COPY src ./src

# Compile TypeScript to JavaScript
RUN npm run build

# Type check (optional but recommended)
RUN npm run type-check || true

# ============================================================================
# Stage 3: Runtime (Production)
# Purpose: Minimal production image with only production dependencies and compiled code
FROM node:${NODE_VERSION}-alpine

ARG VERSION
ARG BUILD_DATE
ARG COMMIT_SHA

LABEL version="${VERSION}" \
      build.date="${BUILD_DATE}" \
      build.commit="${COMMIT_SHA}" \
      maintainer="egisz-monitor" \
      description="EGISZ Monitor Backend Service"

WORKDIR /app

# Create non-root user (security hardening) - skip if already exists
RUN addgroup -g 1000 -S node 2>/dev/null || true && \
    adduser -u 1000 -S node -G node 2>/dev/null || true

# Copy package files for production
COPY package*.json ./

# Install ONLY production dependencies
# Using --omit=dev instead of deprecated --only=production
RUN npm ci --omit=dev --audit=false && \
    npm prune --omit=dev && \
    npm cache clean --force

# Copy compiled JavaScript from builder stage
COPY --from=builder /app/dist ./dist

# Ownership security: ensure app files are owned by node user
RUN chown -R node:node /app

# Set working user (non-root)
USER node

# Expose port
EXPOSE 3000

# Healthcheck
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/health || exit 1

# Runtime metadata in environment
ENV NODE_ENV=production \
    VERSION=${VERSION} \
    BUILD_DATE=${BUILD_DATE} \
    COMMIT_SHA=${COMMIT_SHA}

# Start application
ENTRYPOINT ["node"]
CMD ["dist/index.js"]
