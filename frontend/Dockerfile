# Stage 1: Build Vite frontend
FROM node:20-alpine AS builder

WORKDIR /app

# Copy package files
COPY package*.json tsconfig.json vite.config.ts ./

# Copy config files
COPY tailwind.config.js postcss.config.js ./

# Install dependencies (include devDependencies for build)
RUN npm ci

# Copy source code
COPY src ./src
COPY index.html ./

# Build static assets
RUN npm run build

# Stage 2: Nginx runtime
FROM nginx:alpine

# Remove default nginx config
RUN rm /etc/nginx/conf.d/default.conf

# Copy custom nginx config
COPY nginx.conf /etc/nginx/conf.d/

# Copy built assets from builder
COPY --from=builder /app/dist /usr/share/nginx/html

# Expose port 80
EXPOSE 80

# Healthcheck
HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://127.0.0.1:80 || exit 1

# Start nginx
CMD ["nginx", "-g", "daemon off;"]
