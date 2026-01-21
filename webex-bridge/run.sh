#!/usr/bin/with-contenv bashio
# Home Assistant Add-on Run Script
# Reads configuration from HA and starts the bridge

set -e

# Read configuration from Home Assistant
export WS_PORT=$(bashio::config 'ws_port')
export LOG_LEVEL=$(bashio::config 'log_level')
export MDNS_SERVICE_NAME="webex-bridge"

# Data directory for persistent storage (device registration, etc.)
export DATA_DIR="/data"

bashio::log.info "Starting Webex Bridge..."
bashio::log.info "WebSocket port: ${WS_PORT}"
bashio::log.info "Log level: ${LOG_LEVEL}"
bashio::log.info "Data directory: ${DATA_DIR}"

# Start the bridge
cd /app
exec node dist/index.js
