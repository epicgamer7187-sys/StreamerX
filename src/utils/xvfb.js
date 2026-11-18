'use strict';

const { spawn, spawnSync } = require('child_process');

const DISPLAY = ':99';

/**
 * Start a virtual X display, only when CAPTURE_MODE=x11.
 * Headless tab capture (default) needs no display at all.
 */
function ensureDisplay() {
  if (process.env.CAPTURE_MODE !== 'x11') return;
  if (process.env.DISPLAY) return;

  const width = process.env.STREAM_WIDTH || 1280;
  const height = process.env.STREAM_HEIGHT || 720;

  spawn('Xvfb', [DISPLAY, '-screen', '0', `${width}x${height}x24`, '-nolisten', 'tcp'], {
    stdio: 'ignore',
    detached: true,
  }).unref();

  // wait for the socket to appear instead of a blind sleep
  for (let i = 0; i < 40; i++) {
    const res = spawnSync('xdpyinfo', ['-display', DISPLAY], { stdio: 'ignore' });
    if (res.status === 0) break;
    spawnSync('sleep', ['0.25']);
  }

  process.env.DISPLAY = DISPLAY;
  console.log(`[xvfb] display ${DISPLAY} ready`);
}

module.exports = { ensureDisplay };
