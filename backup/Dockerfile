FROM alpine:3.24

RUN apk add --no-cache postgresql18-client rclone docker-cli curl bash

# supercronic — proper cron daemon for Docker (handles SIGTERM correctly)
# Supports both amd64 and arm64 (Oracle Cloud Ampere A1)
ARG TARGETARCH
RUN ARCH=$([ "$TARGETARCH" = "arm64" ] && echo "linux-arm64" || echo "linux-amd64") && \
    curl -fsSL "https://github.com/aptible/supercronic/releases/download/v0.2.29/supercronic-${ARCH}" \
    -o /usr/local/bin/supercronic && chmod +x /usr/local/bin/supercronic

COPY backup.sh /backup.sh
COPY crontab /crontab
RUN chmod +x /backup.sh

CMD ["supercronic", "/crontab"]
