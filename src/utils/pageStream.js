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
  '--no-first-run',
  '--no-default-browser-check',
  '--autoplay-policy=no-user-gesture-required',
  '--enable-usermedia-screen-capturing',
  '--allow-http-screen-capture',
  '--hide-scrollbars',
  '--mute-audio',
  '--disable-background-timer-throttling',
  '--disable-backgrounding-occluded-windows',
  '--disable-renderer-backgrounding',
];

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

    this.browser = await launch({
      executablePath: EXECUTABLE,
      headless: 'new',
      userDataDir: this.profileDir,
      defaultViewport: { width: this.width, height: this.height },
      args: [...BASE_ARGS, `--window-size=${this.width},${this.height}`],
    });

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
    this.media = await getStream(this.page, {
      audio: this.audio,
      video: true,
      mimeType: this.audio ? 'video/webm;codecs=vp8,opus' : 'video/webm;codecs=vp8',
    });
    return this.media;
  }

  async close() {
    try { this.media?.destroy(); } catch {}
    try { await this.browser?.close(); } catch {}
    try { fs.rmSync(this.profileDir, { recursive: true, force: true }); } catch {}
  }
}

module.exports = { PageCapture };
