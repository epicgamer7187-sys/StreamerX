'use strict';

const { spawn, spawnSync } = require('child_process');

const DISPLAY = ':99';
let started = false;

/**
 * Start a virtual X display.
 * Runs at boot when CAPTURE_MODE=x11, or on demand (force=true) when page
 * capture fails and the session falls back to x11.
 */
function ensureDisplay(force = false) {
  if (!force && process.env.CAPTURE_MODE !== 'x11') return;
  if (started || process.env.DISPLAY) return;
  started = true;

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
