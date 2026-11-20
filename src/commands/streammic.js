'use strict';

const { loadConfig, saveConfig } = require('../utils/dataStore');
const { sessionManager } = require('../utils/streamClient');
const { baseEmbed, successEmbed, errorEmbed, replyEmbed } = require('../utils/helpers');

module.exports = {
  name: 'streammic',
  aliases: ['mic'],
  ownerOnly: true,
  description: 'Also play the stream audio through the bot mic (yes/no)',
  async execute(message, args, client) {
    const cfg = loadConfig();
    const arg = (args[0] || '').toLowerCase();

    if (!arg) {
      return replyEmbed(
        message,
        baseEmbed(message.author, client.botName)
          .setTitle('Stream audio on mic')
          .setDescription(`Current: **${cfg.streamMicAudio ? 'yes' : 'no'}**\nUsage: \`.streammic yes\` or \`.streammic no\``)
      );
    }

    let value;
    if (['yes', 'y', 'on', 'true', '1'].includes(arg)) value = true;
    else if (['no', 'n', 'off', 'false', '0'].includes(arg)) value = false;
    else {
      return replyEmbed(
        message,
        errorEmbed(message.author, client.botName, 'Bad value', 'Use `.streammic yes` or `.streammic no`.')
      );
    }

    cfg.streamMicAudio = value;
    saveConfig(cfg);

    // restart running sessions so the new mode applies
    let n = 0;
    for (const [, entry] of sessionManager.sessions) {
      if (entry.live) {
        await entry.live.switchUrl(entry.live.url).catch(() => {});
        n++;
      }
    }

    return replyEmbed(
      message,
      successEmbed(
        message.author,
        client.botName,
        `Mic audio ${value ? 'enabled' : 'disabled'}`,
        `Live sessions restarted: **${n}**`
      )
    );
  },
};
