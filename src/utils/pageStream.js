'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { launch, getStream } = require('puppeteer-stream');

const EXECUTABLE =
  process.env.PUPPETEER_EXECUTABLE_PATH || process.env.CHROME_BIN || undefined;

const BASE_ARGS = [
  '--no-sandbox',
  '--disable-setuid-sandbox',
  '--disable-dev-shm-usage',
  '--disable-gpu',
  '--no-first-run',
  '--no-default-browser-check',
  '--autoplay-policy=no-user-gesture-required',
  '--enable-usermedia-screen-capturing',
  '--allow-http-screen-capture',
  '--auto-select-desktop-capture-source=Streamer',
  // newer Chromium builds block --load-extension, which puppeteer-stream needs
  '--disable-features=DisableLoadExtensionCommandLineSwitch',
  '--hide-scrollbars',
  '--disable-background-timer-throttling',
  '--disable-backgrounding-occluded-windows',
  '--disable-renderer-backgrounding',
];

function withTimeout(promise, ms, label) {
  let t;
  const timeout = new Promise((_, reject) => {
    t = setTimeout(() => reject(new Error(`${label} timed out after ${ms / 1000}s`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(t));
}

class PageCapture {
  constructor(url, { width, height, audio = true } = {}) {
    this.url = url;
    this.width = width;
    this.height = height;
    this.audio = audio;
    this.browser = null;
    this.page = null;
    this.media = null;
    this.profileDir = null;
  }

  async open() {
    // guest profile: brand new dir, deleted on close
    this.profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'streamerx-guest-'));

    this.browser = await withTimeout(
      launch({
        executablePath: EXECUTABLE,
        headless: 'new',
        userDataDir: this.profileDir,
        defaultViewport: { width: this.width, height: this.height },
        args: [...BASE_ARGS, `--window-size=${this.width},${this.height}`],
      }),
      45_000,
      'browser launch'
    );

    this.page = await this.browser.newPage();
    this.page.setDefaultTimeout(60_000);

    await this.page
      .goto(this.url, { waitUntil: 'domcontentloaded' })
      .catch((err) => console.warn(`[capture] nav warning: ${err.message}`));

    // no scrollbars in frame
    await this.page
      .evaluate(() => {
        document.documentElement.style.overflow = 'hidden';
        document.body.style.overflow = 'hidden';
      })
      .catch(() => {});

    // let the page settle / autoplay kick in
    await new Promise((r) => setTimeout(r, 2500));
  }

  async getStream() {
    // puppeteer-stream hangs forever if its extension failed to load: time out so we can fall back
    this.media = await withTimeout(
      getStream(this.page, {
        audio: this.audio,
        video: true,
        mimeType: this.audio ? 'video/webm;codecs=vp8,opus' : 'video/webm;codecs=vp8',
      }),
      30_000,
      'puppeteer-stream getStream'
    );
    return this.media;
  }

  async close() {
    try { this.media?.destroy(); } catch {}
    try { await this.browser?.close(); } catch {}
    try { fs.rmSync(this.profileDir, { recursive: true, force: true }); } catch {}
  }
}

module.exports = { PageCapture };
