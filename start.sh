#!/bin/bash
DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" >/dev/null 2>&1 && pwd )"
cd "$DIR"

# Kill existing instance if running on port 5000
fuser -k 5000/tcp 2>/dev/null || pkill -f "node.*server.js" 2>/dev/null

echo "Starting Hisense VIDAA IPTV Server..."
node server.js
