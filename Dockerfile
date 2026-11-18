# ---- build stage: install node deps (works with or without package-lock.json) ----
FROM node:22-trixie-slim AS build
WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
      python3 make g++ git ca-certificates \
    && rm -rf /var/lib/apt/lists/*

ENV PUPPETEER_SKIP_DOWNLOAD=true
COPY package.json package-lock.json* ./

# npm ci needs a lockfile; fall back to npm install when there is none.
# --legacy-peer-deps stops peer conflicts between the discord/puppeteer packages.
RUN if [ -f package-lock.json ]; then \
      npm ci --omit=dev --legacy-peer-deps --no-audit --no-fund; \
    else \
      npm install --omit=dev --legacy-peer-deps --no-audit --no-fund; \
    fi

# Quick load check. process.exit(0) + timeout stop a package's open handles from hanging the build.
RUN timeout 60 node -e "for (const m of ['@dank074/discord-video-stream','@lng2004/discord.js-selfbot-v13','puppeteer-stream','discord.js','ws']) { try { require(m); console.log('OK    ', m); } catch (e) { console.error('FAILED', m, '-', e.message); } } process.exit(0)" || echo "dependency check skipped/timed out"

# ---- runtime stage: browser, ffmpeg, libs only ----
FROM node:22-trixie-slim

ENV NODE_ENV=production \
    PUPPETEER_SKIP_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium \
    CHROME_BIN=/usr/bin/chromium \
    DATA_DIR=/data

RUN apt-get update && apt-get install -y --no-install-recommends \
      chromium ffmpeg ca-certificates fonts-liberation fontconfig \
      libnss3 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 libxkbcommon0 \
      libxcomposite1 libxdamage1 libxfixes3 libxrandr2 libgbm1 libasound2t64 \
      libpango-1.0-0 libcairo2 libx11-xcb1 libxss1 \
      xvfb x11-utils procps \
    && rm -rf /var/lib/apt/lists/* \
    && mkdir -p /data

# Debian's ffmpeg 7.1 rejects "-flags lowdelay" (it is now "low_delay"), which the stream library passes.
# This wrapper translates it so transcoding starts.
RUN printf '#!/bin/sh\nfor a; do shift; [ "$a" = "lowdelay" ] && a=low_delay; set -- "$@" "$a"; done\nexec /usr/bin/ffmpeg "$@"\n' > /usr/local/bin/ffmpeg \
    && chmod +x /usr/local/bin/ffmpeg

WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY . .

CMD ["node", "index.js"]
