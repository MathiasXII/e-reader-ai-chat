#!/bin/bash

# Default values
PORT=8000
HOST="0.0.0.0"

# Parse arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        -p|--port)
            PORT="$2"
            shift 2
            ;;
        -h|--host)
            HOST="$2"
            shift 2
            ;;
        *)
            echo "Usage: $0 [-p|--port PORT] [-h|--host HOST]"
            exit 1
            ;;
    esac
done

# Kill any existing server on this port
EXISTING=$(lsof -ti :$PORT 2>/dev/null | grep -E '(python|python3)' || true)
if [ -n "$EXISTING" ]; then
    echo -e "\033[31mStopping existing server (PIDs: $EXISTING) on port $PORT ...\033[0m"
    kill $EXISTING 2>/dev/null
    sleep 2
fi

echo -e "\033[32mStarting E-Reader LLM server on http://${HOST}:${PORT}/\033[0m"
echo -e "\033[33mPress Ctrl+C to stop.\033[0m"
python -m uvicorn server:app --host $HOST --port $PORT
