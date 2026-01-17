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

# Validate required configuration
if [ -z "$WEBEX_CLIENT_ID" ]; then
    bashio::log.fatal "Webex Client ID is required"
    exit 1
fi

if [ -z "$WEBEX_CLIENT_SECRET" ]; then
    bashio::log.fatal "Webex Client Secret is required"
    exit 1
fi

if [ -z "$WEBEX_REFRESH_TOKEN" ]; then
    bashio::log.fatal "Webex Refresh Token is required"
    exit 1
fi

bashio::log.info "Starting Webex Bridge..."
bashio::log.info "WebSocket port: ${WS_PORT}"
bashio::log.info "Log level: ${LOG_LEVEL}"

# Start the bridge
cd /app
exec node dist/index.js
