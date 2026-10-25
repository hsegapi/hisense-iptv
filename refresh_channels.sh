#!/bin/bash
# IPTV Channel Auto-Refresh Script for Hisense IPTV
# Downloads, combines, and updates all M3U channels from https://iptv-org.github.io/

DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" >/dev/null 2>&1 && pwd )"
cd "$DIR"

LOG_FILE="$DIR/refresh.log"
echo "[$(date '+%Y-%m-%d %H:%M:%S')] Starting channel refresh from https://iptv-org.github.io/..." | tee -a "$LOG_FILE"

# Run Python combiner script
python3 "$DIR/refresh_channels.py" 2>&1 | tee -a "$LOG_FILE"

EXIT_CODE=${PIPESTATUS[0]}
if [ $EXIT_CODE -eq 0 ]; then
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] Channel refresh completed successfully!" | tee -a "$LOG_FILE"
else
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] Channel refresh failed with code $EXIT_CODE" | tee -a "$LOG_FILE"
fi

exit $EXIT_CODE
