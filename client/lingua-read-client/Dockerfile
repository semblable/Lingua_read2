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

# -------- Runtime Stage --------
# Unprivileged nginx: runs as uid 101, listens on 8080 (and 8443 with the SSL config).
FROM nginxinc/nginx-unprivileged:stable-alpine AS production
WORKDIR /usr/share/nginx/html

# The html dir is root-owned; switch to root for the asset swap, then drop back.
USER root
RUN rm -rf ./*
COPY --from=build /app/build ./
COPY nginx.conf /etc/nginx/nginx.conf
USER 101

EXPOSE 8080

CMD ["nginx", "-g", "daemon off;"]
