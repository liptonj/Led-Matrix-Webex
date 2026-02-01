#!/bin/bash
set -e

SUPABASE_URL="${SUPABASE_URL:-https://fmultmlsevqgtnqzaylg.supabase.co}"
EDGE_FUNCTION_URL="$SUPABASE_URL/functions/v1"

echo "🏥 API Health Check Smoke Tests"
echo "Testing Edge Functions: $EDGE_FUNCTION_URL"

# Test 1: Get Manifest (public endpoint)
echo -n "Testing get-manifest... "
RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" "$EDGE_FUNCTION_URL/get-manifest")
if [ "$RESPONSE" = "200" ]; then
  echo "✓ PASS"
else
  echo "✗ FAIL (HTTP $RESPONSE)"
  exit 1
fi

# Test 2: Device Auth (expects 400/401 without credentials - proves endpoint is alive)
echo -n "Testing device-auth... "
RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$EDGE_FUNCTION_URL/device-auth")
if [ "$RESPONSE" = "400" ] || [ "$RESPONSE" = "401" ]; then
  echo "✓ PASS (endpoint responsive)"
else
  echo "✗ FAIL (HTTP $RESPONSE - endpoint may be down)"
  exit 1
fi

# Test 3: Get Firmware (expects 400 or 401 without authentication - proves endpoint is alive)
echo -n "Testing get-firmware... "
RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" "$EDGE_FUNCTION_URL/get-firmware")
if [ "$RESPONSE" = "400" ] || [ "$RESPONSE" = "401" ]; then
  echo "✓ PASS (endpoint responsive)"
else
  echo "✗ FAIL (HTTP $RESPONSE - endpoint may be down)"
  exit 1
fi

# Test 4: Validate Manifest JSON structure
echo -n "Testing manifest JSON structure... "
MANIFEST=$(curl -s "$EDGE_FUNCTION_URL/get-manifest")
if echo "$MANIFEST" | jq -e '.version and .firmware' > /dev/null 2>&1; then
  echo "✓ PASS"
else
  echo "✗ FAIL (invalid JSON structure)"
  exit 1
fi

echo ""
echo "✅ All API health checks passed"
