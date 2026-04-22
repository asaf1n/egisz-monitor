FROM metabase/metabase:latest

RUN apk add --no-cache jq curl postgresql-client

# Copy provisioning files
COPY ../metabase-init/provision.sh /app/provision.sh
COPY ../metabase-init/setup-dashboards.sh /app/setup-dashboards.sh
COPY ../metabase_dashboards/ /app/metabase_dashboards/
COPY ../metabase/entrypoint.sh /app/entrypoint.sh

# Make scripts executable
RUN chmod +x /app/provision.sh /app/setup-dashboards.sh /app/entrypoint.sh

# Set entrypoint
ENTRYPOINT ["/bin/bash", "/app/entrypoint.sh"]
