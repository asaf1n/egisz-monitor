FROM nginx:1.27-alpine

RUN apk add --no-cache bash gettext

COPY metabase-proxy/nginx.conf.template /etc/nginx/templates/default.conf.template
COPY metabase-proxy/entrypoint.sh /entrypoint.sh

RUN chmod +x /entrypoint.sh

ENTRYPOINT ["/entrypoint.sh"]
