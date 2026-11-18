'use strict';

const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

class X11Capture {
  constructor(url, { width, height, fps }) {
    this.url = url;
    this.width = width;
    this.height = height;
    this.fps = fps;
    this.chrome = null;
    this.ffmpeg = null;
    this.fifo = path.join(os.tmpdir(), `streamerx-${process.pid}-${Date.now()}.ts`);
    this.profileDir = null;
  }

  async open() {
    const display = process.env.DISPLAY || ':99';
    this.profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'streamerx-guest-'));

    this.chrome = spawn(
      process.env.CHROME_BIN || 'chromium',
      [
        '--no-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--incognito',
        `--user-data-dir=${this.profileDir}`,
        '--no-first-run',
        '--no-default-browser-check',
        '--autoplay-policy=no-user-gesture-required',
        '--hide-scrollbars',
        '--kiosk',
        `--window-size=${this.width},${this.height}`,
        '--window-position=0,0',
        this.url,
      ],
      { stdio: ['ignore', 'ignore', 'ignore'] }
    );

    spawnSync('mkfifo', [this.fifo]);

    this.ffmpeg = spawn(
      'ffmpeg',
      [
        '-hide_banner', '-loglevel', 'error', '-nostdin', '-y',
        '-f', 'x11grab', '-draw_mouse', '0', '-framerate', String(this.fps),
        '-video_size', `${this.width}x${this.height}`, '-i', `${display}.0+0,0`,
        '-c:v', 'libx264', '-preset', 'ultrafast', '-tune', 'zerolatency',
        '-pix_fmt', 'yuv420p', '-g', String(this.fps * 2),
        '-b:v', '4000k', '-maxrate', '5000k', '-bufsize', '8000k',
        '-f', 'mpegts', '-flush_packets', '1', this.fifo,
      ],
      { stdio: ['ignore', 'ignore', 'ignore'] }
    );

    await new Promise((r) => setTimeout(r, 3000));
  }

  async getStream() {
    return fs.createReadStream(this.fifo);
  }

  async close() {
    try { this.ffmpeg?.kill('SIGKILL'); } catch {}
    try { this.chrome?.kill('SIGKILL'); } catch {}
    try { fs.rmSync(this.fifo, { force: true }); } catch {}
    try { fs.rmSync(this.profileDir, { recursive: true, force: true }); } catch {}
  }
}

module.exports = { X11Capture };
