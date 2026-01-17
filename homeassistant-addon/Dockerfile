# Home Assistant Add-on Dockerfile
# Multi-arch build for aarch64, amd64, armv7

ARG BUILD_FROM
FROM ${BUILD_FROM}

# Install Node.js
RUN apk add --no-cache nodejs npm

# Set working directory
WORKDIR /app

# Copy bridge source
COPY bridge/package*.json ./
RUN npm install --omit=dev

COPY bridge/dist ./dist

# Copy run script
COPY homeassistant-addon/run.sh /run.sh
RUN chmod +x /run.sh

# Expose WebSocket port
EXPOSE 8080

CMD ["/run.sh"]
