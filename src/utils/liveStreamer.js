'use strict';

const { Transform, PassThrough } = require('stream');
const { spawn } = require('child_process');
const { Client } = require('@lng2004/discord.js-selfbot-v13');
const {
  Streamer,
  prepareStream,
  playStream,
  Utils,
} = require('@dank074/discord-video-stream');
const { loadConfig } = require('./dataStore');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const WIDTH = Number(process.env.STREAM_WIDTH || 1280);
const HEIGHT = Number(process.env.STREAM_HEIGHT || 720);
const FPS = Number(process.env.STREAM_FPS || 30);
const BITRATE = Number(process.env.STREAM_BITRATE_KBPS || 2500);
const AUDIO = process.env.STREAM_AUDIO !== 'false';

// watchdog: no captured data for this long, or stream connection lost this long -> restart the pump
const STALL_MS = Number(process.env.STREAM_STALL_MS || 20_000);

function makeCapture(url, mode) {
  const opts = { width: WIDTH, height: HEIGHT, fps: FPS, audio: AUDIO };
  if (mode === 'x11') {
    require('./xvfb').ensureDisplay(true);
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
    this.captureMode = process.env.CAPTURE_MODE === 'x11' ? 'x11' : 'page';
    this.pageFailures = 0;
    this.gen = 0;
    this.abort = null;
    this.client = null;
    this.streamer = null;
    this.streamStartedAt = 0;
    this._voiceTimer = null;
    this._unmuteTimer = null;
    this._mic = null;
  }

  async start() {
    this.client = new Client({ checkUpdate: false });
    this.streamer = new Streamer(this.client);

    this.client.on('error', (err) =>
      console.error(`[live:${this.userId}] client error: ${err.message}`)
    );
    this.client.on('raw', (packet) => this._onRaw(packet));

    await this.client.login(this.token);
    this.username = this.client.user?.username || 'Unknown';

    await this.streamer.joinVoice(this.guildId, this.channelId);
    console.log(`[live:${this.userId}] ${this.username} joined ${this.channelId}`);

    // make sure the account is NOT muted / deafened, and keep it that way
    await sleep(1000);
    this._sendVoiceState();
    this._voiceTimer = setInterval(() => this._sendVoiceState(), 45_000);

    this._restartPump();
  }

  /** Voice state op 4 with mute + deaf OFF. */
  _sendVoiceState() {
    if (this.stopped) return;
    const payload = {
      guild_id: this.guildId,
      channel_id: this.channelId,
      self_mute: false,
      self_deaf: false,
      self_video: false,
    };
    try {
      if (typeof this.streamer?.sendOpcode === 'function') this.streamer.sendOpcode(4, payload);
      else this.client.ws.broadcast({ op: 4, d: payload });
    } catch (err) {
      console.warn(`[live:${this.userId}] voice state: ${err.message}`);
    }
  }

  _onRaw(packet) {
    if (!packet || this.stopped) return;
    const me = this.client?.user?.id;
    if (!me) return;

    // library (or Discord) flipped us back to muted/deafened -> undo it
    if (packet.t === 'VOICE_STATE_UPDATE' && packet.d?.user_id === me) {
      if (packet.d.self_mute || packet.d.self_deaf) {
        clearTimeout(this._unmuteTimer);
        this._unmuteTimer = setTimeout(() => this._sendVoiceState(), 600);
      }
    }

    // Discord closed our Go Live (viewers see an endless loading spinner) -> rebuild it
    if (packet.t === 'STREAM_DELETE') {
      const key = String(packet.d?.stream_key || '');
      if (
        key.endsWith(`:${me}`) &&
        this.streaming &&
        Date.now() - this.streamStartedAt > 20_000
      ) {
        console.warn(`[live:${this.userId}] Discord deleted the stream (${packet.d?.reason || '?'}), restarting`);
        this._restartPump();
      }
    }
  }

  _restartPump() {
    const gen = ++this.gen;
    try { this.abort?.abort(); } catch {}
    this._stopMic();
    this._pump(gen).catch((err) => {
      if (!this.stopped) console.error(`[live:${this.userId}] pump: ${err.message}`);
    });
  }

  async _pump(gen) {
    while (!this.stopped && gen === this.gen) {
      // fresh controller per iteration (a reused, already-aborted one made every restart die instantly)
      const ac = new AbortController();
      this.abort = ac;

      let capture = null;
      let started = false;
      let watchdog = null;
      try {
        capture = makeCapture(this.url, this.captureMode);
        await capture.open();
        if (gen !== this.gen) break;

        const media = await capture.getStream();

        let inBytes = 0;
        const input = new Transform({
          transform(chunk, _enc, cb) {
            inBytes += chunk.length;
            cb(null, chunk);
          },
        });
        media.on('error', (e) => input.destroy(e));
        media.pipe(input);

        const micOn = AUDIO && !!loadConfig().streamMicAudio;
        let micSource = null;
        if (micOn) {
          micSource = new PassThrough();
          media.pipe(micSource);
        }
        console.log(`[live:${this.userId}] capture open, waiting for data...`);

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
          ac.signal
        );
        promise.catch((err) => {
          if (!ac.signal.aborted) {
            console.error(`[live:${this.userId}] transcode: ${err.message}`);
          }
        });

        this.streaming = true;
        this.streamStartedAt = Date.now();
        started = true;
        this.pageFailures = 0;
        console.log(`[live:${this.userId}] go live (${this.captureMode})`);

        // watchdog: frozen capture or lost stream connection = viewers stuck on "loading"
        let lastBytes = 0;
        let lastGrowth = Date.now();
        let hadConn = false;
        let connLostAt = 0;
        watchdog = setInterval(() => {
          if (ac.signal.aborted) return;
          if (inBytes !== lastBytes) {
            lastBytes = inBytes;
            lastGrowth = Date.now();
          } else if (Date.now() - lastGrowth > STALL_MS) {
            console.warn(`[live:${this.userId}] capture stalled ${STALL_MS / 1000}s, restarting stream`);
            ac.abort();
            return;
          }
          const sc = this.streamer?.voiceConnection?.streamConnection;
          if (sc) {
            hadConn = true;
            connLostAt = 0;
          } else if (hadConn) {
            connLostAt = connLostAt || Date.now();
            if (Date.now() - connLostAt > STALL_MS) {
              console.warn(`[live:${this.userId}] stream connection lost, restarting stream`);
              ac.abort();
            }
          }
          console.log(
            `[live:${this.userId}] status: captured=${Math.round(inBytes / 1024)}KB streamConnection=${sc ? 'yes' : 'no'}`
          );
        }, 5_000);

        // once Go Live is up: unmute again (stream setup can reset it) and optionally start the mic feed
        setTimeout(() => {
          if (!ac.signal.aborted) this._sendVoiceState();
        }, 4_000);
        if (micSource) {
          setTimeout(() => {
            if (!ac.signal.aborted) this._startMic(micSource, ac.signal);
          }, 6_000);
        }

        try {
          await playStream(
            output,
            this.streamer,
            { type: 'go-live', readrateInitialBurst: 10 },
            ac.signal
          );
          console.log(`[live:${this.userId}] playStream ended`);
        } finally {
          clearInterval(watchdog);
          watchdog = null;
          this._stopMic();
        }
      } catch (err) {
        if (!this.stopped && gen === this.gen && !ac.signal.aborted) {
          console.error(`[live:${this.userId}] capture (${this.captureMode}): ${err.message}`);
          if (
            !started &&
            this.captureMode === 'page' &&
            process.env.CAPTURE_FALLBACK !== 'false' &&
            ++this.pageFailures >= 2
          ) {
            this.captureMode = 'x11';
            console.warn(`[live:${this.userId}] page capture failed twice, switching to x11 capture`);
          }
        }
      } finally {
        if (watchdog) clearInterval(watchdog);
        this.streaming = false;
        await capture?.close();
      }

      if (!this.stopped && gen === this.gen) await sleep(3000);
    }
  }

  /**
   * EXPERIMENTAL: send the page audio through the account's voice connection (the "mic") in addition to
   * the Go Live audio. Audio-only copy of the captured webm (already Opus) -> library `camera` playback,
   * which writes to the voice connection instead of the stream connection.
   */
  _startMic(source, signal) {
    if (this._mic || signal.aborted) return;
    try {
      const ff = spawn(
        'ffmpeg',
        [
          '-hide_banner', '-loglevel', 'error', '-nostdin',
          '-i', 'pipe:0',
          '-vn', '-c:a', 'libopus', '-ar', '48000', '-ac', '2', '-b:a', '128k',
          '-f', 'matroska', 'pipe:1',
        ],
        { stdio: ['pipe', 'pipe', 'ignore'] }
      );
      ff.stdin.on('error', () => {});
      ff.stdout.on('error', () => {});
      source.pipe(ff.stdin);
      this._mic = { ff, source };

      playStream(ff.stdout, this.streamer, { type: 'camera' }, signal)
        .then(() => console.log(`[live:${this.userId}] mic audio ended`))
        .catch((err) => {
          if (!signal.aborted) console.warn(`[live:${this.userId}] mic audio failed: ${err.message}`);
        });
      console.log(`[live:${this.userId}] mic audio on`);
    } catch (err) {
      console.warn(`[live:${this.userId}] mic audio could not start: ${err.message}`);
      this._stopMic();
    }
  }

  _stopMic() {
    const m = this._mic;
    this._mic = null;
    if (!m) return;
    try { m.source.unpipe(); } catch {}
    try { m.ff.kill('SIGKILL'); } catch {}
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
    clearInterval(this._voiceTimer);
    clearTimeout(this._unmuteTimer);
    try { this.abort?.abort(); } catch {}
    this._stopMic();
    try { this.streamer?.stopStream(); } catch {}
    try { this.streamer?.leaveVoice(); } catch {}
    await sleep(300);
    try { await this.client?.destroy(); } catch {}
    this.streaming = false;
  }
}

module.exports = { LiveSession };
