#!/bin/sh
set -e
if [ "${CAPTURE_MODE:-page}" = "x11" ]; then
  Xvfb :99 -screen 0 "${STREAM_WIDTH:-1280}x${STREAM_HEIGHT:-720}x24" -nolisten tcp &
  sleep 1
  export DISPLAY=:99
fi
exec node index.js
