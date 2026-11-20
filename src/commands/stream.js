'use strict';

const { loadConfig, saveConfig } = require('../utils/dataStore');
const { sessionManager } = require('../utils/streamClient');
const { baseEmbed, successEmbed, errorEmbed, replyEmbed } = require('../utils/helpers');

module.exports = {
  name: 'stream',
  aliases: ['url', 'setstream'],
  ownerOnly: true,
  description: 'Set the URL every session streams (owner only, never displayed)',
  async execute(message, args, client) {
    const raw = args.join(' ').trim();
    const cfg = loadConfig();
    const reply = (emb) => message.channel.send({ embeds: [emb] });

    // status only: never print the URL itself
    if (!raw) {
      return replyEmbed(
        message,
        baseEmbed(message.author, client.botName)
          .setTitle('Stream URL')
          .setDescription(
            `Status: ${cfg.streamUrl ? '**set** (hidden)' : '**not set**'}\n\nSet: \`.stream <url>\` · Remove: \`.stream clear\``
          )
      );
    }

    // hide the URL: remove the owner's message before doing anything else
    await message.delete().catch(() => {});

    if (['clear', 'reset', 'none', 'off'].includes(raw.toLowerCase())) {
      cfg.streamUrl = null;
      saveConfig(cfg);
      return reply(successEmbed(message.author, client.botName, 'Stream URL cleared', 'No URL is set now.'));
    }

    let parsed;
    try {
      parsed = new URL(raw);
    } catch {
      return reply(errorEmbed(message.author, client.botName, 'Bad URL', 'That is not a valid URL.'));
    }
    if (!/^https?:$/.test(parsed.protocol)) {
      return reply(errorEmbed(message.author, client.botName, 'Bad URL', 'Only http/https URLs work.'));
    }

    cfg.streamUrl = parsed.toString();
    saveConfig(cfg);

    // switch every running session to the new page
    let switched = 0;
    for (const [, entry] of sessionManager.sessions) {
      if (entry.live) {
        await entry.live.switchUrl(cfg.streamUrl).catch(() => {});
        switched++;
      }
    }

    return reply(
      successEmbed(
        message.author,
        client.botName,
        'Stream URL saved',
        `The URL is stored privately and is not shown anywhere.\nLive sessions switched: **${switched}**`
      )
    );
  },
};
