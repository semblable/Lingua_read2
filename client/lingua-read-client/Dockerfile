# syntax=docker/dockerfile:1.7
# -------- Build Stage --------
FROM node:26-alpine AS build
WORKDIR /app

# Install dependencies
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci --legacy-peer-deps

# Copy source code and build
COPY . ./
RUN npm run build

# -------- Config validation stage --------
# Fails the image build (and therefore the PR) if either nginx config has a syntax
# error or uses a directive the runtime image's nginx doesn't support. This matters
# especially for nginx.ssl.conf: it is bind-mounted at deploy time (never baked into
# the image), so without this stage the first thing to exercise it would be the
# production container. ssl_certificate directives need real files to parse, so
# throwaway certs are generated for the check.
FROM nginxinc/nginx-unprivileged:stable-alpine AS config-test
USER root
RUN apk add --no-cache openssl
COPY nginx.conf /tmp/nginx-test/nginx.conf
COPY nginx.ssl.conf /tmp/nginx-test/nginx.ssl.conf
# The `upstream api:5000` hostname is resolved at config-parse time and the compose
# service name doesn't resolve here (and /etc/hosts is read-only under BuildKit), so
# point the upstream at loopback in the throwaway test copies only.
RUN sed -i 's/server api:5000;/server 127.0.0.1:5000;/' /tmp/nginx-test/nginx.conf /tmp/nginx-test/nginx.ssl.conf \
    && ln -s /etc/nginx/mime.types /tmp/nginx-test/mime.types \
    && mkdir -p /etc/nginx/certs \
    && openssl req -x509 -newkey rsa:2048 -nodes -days 1 -subj "/CN=config-test" \
        -keyout /etc/nginx/certs/privkey.pem -out /etc/nginx/certs/fullchain.pem \
    && nginx -t -c /tmp/nginx-test/nginx.conf \
    && nginx -t -c /tmp/nginx-test/nginx.ssl.conf \
    && touch /nginx-configs-validated

# -------- Runtime Stage --------
# Unprivileged nginx: runs as uid 101, listens on 8080 (and 8443 with the SSL config).
FROM nginxinc/nginx-unprivileged:stable-alpine AS production
WORKDIR /usr/share/nginx/html

# The html dir is root-owned; switch to root for the asset swap, then drop back.
USER root
RUN rm -rf ./*
COPY --from=build /app/build ./
# Pre-compress text assets once at build time; nginx serves them via gzip_static
# instead of re-gzipping the same immutable files on every request. woff2/images
# are already compressed formats and are deliberately skipped. (gzip -c rather
# than -k: BusyBox gzip has no --keep.)
RUN find . -type f \( -name '*.js' -o -name '*.css' -o -name '*.html' -o -name '*.svg' -o -name '*.json' -o -name '*.webmanifest' -o -name '*.txt' \) \
    -exec sh -c 'gzip -9 -c "$1" > "$1.gz"' _ {} \;
COPY nginx.conf /etc/nginx/nginx.conf
# Pull the marker from config-test so BuildKit cannot skip that stage.
COPY --from=config-test /nginx-configs-validated /tmp/nginx-configs-validated
USER 101

EXPOSE 8080

CMD ["nginx", "-g", "daemon off;"]
