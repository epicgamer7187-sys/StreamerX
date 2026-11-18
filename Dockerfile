# ---- build stage: compile/install everything ----
FROM node:22-trixie-slim AS build
WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
      python3 make g++ ca-certificates \
    && rm -rf /var/lib/apt/lists/*

ENV PUPPETEER_SKIP_DOWNLOAD=true
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev
RUN node -e "require('@dank074/discord-video-stream'); require('@lng2004/discord.js-selfbot-v13'); require('puppeteer-stream'); console.log('deps ok')"

# ---- runtime stage: browser, ffmpeg, libs only ----
FROM node:22-trixie-slim

ENV NODE_ENV=production \
    PUPPETEER_SKIP_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium \
    CHROME_BIN=/usr/bin/chromium

RUN apt-get update && apt-get install -y --no-install-recommends \
      chromium ffmpeg ca-certificates fonts-liberation fontconfig \
      libnss3 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 libxkbcommon0 \
      libxcomposite1 libxdamage1 libxfixes3 libxrandr2 libgbm1 libasound2t64 \
      libpango-1.0-0 libcairo2 libx11-xcb1 libxss1 \
      xvfb x11-utils procps \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY . .

EXPOSE 3000
CMD ["node", "index.js"]
