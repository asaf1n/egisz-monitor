#!/bin/sh

set -eu

UUID_FILE="${METABASE_PUBLIC_UUID_FILE:-/shared/main-dashboard-public-uuid}"
CURRENT_UUID=""

write_config() {
  local uuid="$1"

  if [ -n "${uuid}" ]; then
    cat > /etc/nginx/conf.d/default.conf <<EOF
server {
  listen 80;
  server_name _;
  absolute_redirect off;

  location = /healthz {
    access_log off;
    return 200 'ok';
    add_header Content-Type text/plain;
  }

  location = / {
    return 302 /public/dashboard/${uuid};
  }

  location / {
    proxy_pass http://metabase:3000;
    proxy_http_version 1.1;
    proxy_set_header Host \$host;
    proxy_set_header X-Real-IP \$remote_addr;
    proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto \$scheme;
    proxy_set_header Upgrade \$http_upgrade;
    proxy_set_header Connection "upgrade";
  }
}
EOF
  else
    cat > /etc/nginx/conf.d/default.conf <<'EOF'
server {
  listen 80;
  server_name _;
  absolute_redirect off;

  location = /healthz {
    access_log off;
    return 200 'ok';
    add_header Content-Type text/plain;
  }

  location = / {
    default_type text/html;
    add_header Content-Type text/html;
    return 200 '<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="refresh" content="3"><title>Metabase</title></head><body style="font-family:sans-serif;background:#111827;color:#e5e7eb;display:flex;align-items:center;justify-content:center;height:100vh;margin:0">Metabase initializing...</body></html>';
  }

  location / {
    proxy_pass http://metabase:3000;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
  }
}
EOF
  fi
}

if [ -s "${UUID_FILE}" ]; then
  CURRENT_UUID="$(cat "${UUID_FILE}")"
fi

write_config "${CURRENT_UUID}"
nginx -g 'daemon off;' &
NGINX_PID=$!

trap 'kill "${NGINX_PID}" 2>/dev/null || true' INT TERM

while kill -0 "${NGINX_PID}" 2>/dev/null; do
  NEW_UUID=""

  if [ -s "${UUID_FILE}" ]; then
    NEW_UUID="$(cat "${UUID_FILE}")"
  fi

  if [ "${NEW_UUID}" != "${CURRENT_UUID}" ]; then
    CURRENT_UUID="${NEW_UUID}"
    write_config "${CURRENT_UUID}"
    nginx -s reload >/dev/null 2>&1 || true
  fi

  sleep 2
done

wait "${NGINX_PID}"
