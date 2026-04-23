FROM metabase/metabase:latest

RUN apk add --no-cache jq curl postgresql-client

# Copy provisioning files (correct context-relative paths)
COPY metabase-init/provision.sh /app/provision.sh
COPY metabase-init/setup-dashboards.sh /app/setup-dashboards.sh
COPY metabase_dashboards/ /app/metabase_dashboards/
COPY metabase/entrypoint.sh /app/entrypoint.sh

# Make scripts executable with proper permissions
RUN chmod +x /app/provision.sh /app/setup-dashboards.sh /app/entrypoint.sh && \
    chmod -R a+r /app/metabase_dashboards/

# Verify files exist
RUN test -f /app/provision.sh && test -f /app/setup-dashboards.sh && \
    echo "[build] Metabase provisioning scripts verified"

# Set entrypoint
ENTRYPOINT ["/bin/bash", "/app/entrypoint.sh"]
