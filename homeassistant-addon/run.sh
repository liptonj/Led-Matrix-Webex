#!/usr/bin/with-contenv bashio
# Home Assistant Add-on Run Script
# Reads configuration from HA and starts the bridge

set -e

# Read configuration from Home Assistant
export WEBEX_CLIENT_ID=$(bashio::config 'webex_client_id')
export WEBEX_CLIENT_SECRET=$(bashio::config 'webex_client_secret')
export WEBEX_REFRESH_TOKEN=$(bashio::config 'webex_refresh_token')
export WS_PORT=$(bashio::config 'ws_port')
export LOG_LEVEL=$(bashio::config 'log_level')
export MDNS_SERVICE_NAME="webex-bridge"

# Data directory for persistent storage (device registration, etc.)
export DATA_DIR="/data"

bashio::log.info "Starting Webex Bridge..."
bashio::log.info "WebSocket port: ${WS_PORT}"
bashio::log.info "Log level: ${LOG_LEVEL}"
bashio::log.info "Data directory: ${DATA_DIR}"

# Check if Webex credentials are configured
if [ -n "$WEBEX_CLIENT_ID" ] && [ -n "$WEBEX_CLIENT_SECRET" ] && [ -n "$WEBEX_REFRESH_TOKEN" ]; then
    bashio::log.info "Webex credentials configured - OAuth mode enabled"
else
    bashio::log.info "No Webex credentials - running in pairing-only mode"
fi

# Start the bridge
cd /app
exec node dist/index.js
