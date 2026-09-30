#!/bin/sh
# Production startup script for Docker

set -e

echo "Starting Karaoke Fighter in production mode..."

# Run server in background
echo "Starting server on port ${PORT:-3001}..."
npx tsx server/index.ts &
SERVER_PID=$!

# Give server time to start
sleep 2

# Start nginx for client
echo "Starting client on port 3000..."
nginx -g "daemon off;" &
NGINX_PID=$!

# Handle shutdown
trap "kill $SERVER_PID $NGINX_PID; exit 0" SIGTERM SIGINT

# Wait for any process to exit
wait -n

# If one dies, kill the other
kill $SERVER_PID $NGINX_PID 2>/dev/null
wait