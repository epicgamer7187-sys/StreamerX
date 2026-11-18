'use strict';

const { Client } = require('@lng2004/discord.js-selfbot-v13');
const {
  Streamer,
  prepareStream,
  playStream,
  Utils,
} = require('@dank074/discord-video-stream');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const WIDTH = Number(process.env.STREAM_WIDTH || 1280);
const HEIGHT = Number(process.env.STREAM_HEIGHT || 720);
const FPS = Number(process.env.STREAM_FPS || 30);
const BITRATE = Number(process.env.STREAM_BITRATE_KBPS || 2500);
const AUDIO = process.env.STREAM_AUDIO !== 'false';

function makeCapture(url) {
  const opts = { width: WIDTH, height: HEIGHT, fps: FPS, audio: AUDIO };
  if (process.env.CAPTURE_MODE === 'x11') {
    const { X11Capture } = require('./x11Capture');
    return new X11Capture(url, opts);
  }
  const { PageCapture } = require('./pageStream');
  return new PageCapture(url, opts);
}

class LiveSession {
  constructor({ userId, token, guildId, channelId, url }) {
    this.userId = userId;
    this.token = String(token).trim();
    this.guildId = guildId || null;
    this.channelId = String(channelId);
    this.url = url;
    this.username = 'Unknown';
    this.streaming = false;
    this.stopped = false;
    this.gen = 0;
    this.abort = null;
    this.client = null;
    this.streamer = null;
  }

  async start() {
    this.client = new Client({ checkUpdate: false });
    this.streamer = new Streamer(this.client);

    this.client.on('error', (err) =>
      console.error(`[live:${this.userId}] client error: ${err.message}`)
    );

    await this.client.login(this.token);
    this.username = this.client.user?.username || 'Unknown';

    await this.streamer.joinVoice(this.guildId, this.channelId);
    console.log(`[live:${this.userId}] ${this.username} joined ${this.channelId}`);

    this._restartPump();
  }

  _restartPump() {
    const gen = ++this.gen;
    try { this.abort?.abort(); } catch {}
    this.abort = new AbortController();
    this._pump(gen).catch((err) => {
      if (!this.stopped) console.error(`[live:${this.userId}] pump: ${err.message}`);
    });
  }

  async _pump(gen) {
    while (!this.stopped && gen === this.gen) {
      let capture = null;
      try {
        capture = makeCapture(this.url);
        await capture.open();
        if (gen !== this.gen) break;

        const input = await capture.getStream();

        const { output, promise } = await prepareStream(
          input,
          {
            width: WIDTH,
            height: HEIGHT,
            frameRate: FPS,
            bitrateVideo: BITRATE,
            bitrateVideoMax: Math.round(BITRATE * 1.4),
            videoCodec: Utils.normalizeVideoCodec('H264'),
            minimizeLatency: true,
          },
          this.abort.signal
        );
        promise.catch((err) => {
          if (!this.abort?.signal.aborted) {
            console.error(`[live:${this.userId}] transcode: ${err.message}`);
          }
        });

        this.streaming = true;
        console.log(`[live:${this.userId}] go live → ${this.url}`);

        await playStream(
          output,
          this.streamer,
          { type: 'go-live', readrateInitialBurst: 10 },
          this.abort.signal
        );
      } catch (err) {
        if (!this.stopped && gen === this.gen) {
          console.error(`[live:${this.userId}] capture: ${err.message}`);
        }
      } finally {
        this.streaming = false;
        await capture?.close();
      }

      if (!this.stopped && gen === this.gen) await sleep(3000);
    }
  }

  async waitForStreamKey(timeoutMs = 20_000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const key = this.streamer?.voiceConnection?.streamConnection?.streamKey;
      if (key) return key;
      await sleep(500);
    }
    return null;
  }

  async switchUrl(url) {
    this.url = url;
    this._restartPump();
    await sleep(500);
  }

  async stop() {
    this.stopped = true;
    this.gen++;
    try { this.abort?.abort(); } catch {}
    try { this.streamer?.stopStream(); } catch {}
    try { this.streamer?.leaveVoice(); } catch {}
    await sleep(300);
    try { await this.client?.destroy(); } catch {}
    this.streaming = false;
  }
}

module.exports = { LiveSession };
