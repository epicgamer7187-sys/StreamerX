'use strict';

const { getUser, setUser } = require('../utils/dataStore');
const { sessionManager } = require('../utils/streamClient');
const { baseEmbed, successEmbed, errorEmbed, replyEmbed } = require('../utils/helpers');

module.exports = {
  name: 'stream',
  aliases: ['url', 'setstream'],
  description: 'Set the URL the main account streams when it goes live',
  async execute(message, args, client) {
    const userId = message.author.id;
    const raw = args.join(' ').trim();

    if (!raw) {
      const u = getUser(userId);
      return replyEmbed(
        message,
        baseEmbed(message.author, client.botName)
          .setTitle('Stream URL')
          .setDescription(
            `Current: ${u.streamUrl ? `\`${u.streamUrl}\`` : '*none*'}\n\nSet one with \`.stream https://example.com\``
          )
      );
    }

    let parsed;
    try {
      parsed = new URL(raw);
    } catch {
      return replyEmbed(
        message,
        errorEmbed(message.author, client.botName, 'Bad URL', 'That is not a valid URL.')
      );
    }
    if (!/^https?:$/.test(parsed.protocol)) {
      return replyEmbed(
        message,
        errorEmbed(message.author, client.botName, 'Bad URL', 'Only http/https URLs work.')
      );
    }

    setUser(userId, { streamUrl: parsed.toString() });

    const entry = sessionManager.get(userId);
    if (entry?.live) await entry.live.switchUrl(parsed.toString());

    return replyEmbed(
      message,
      successEmbed(
        message.author,
        client.botName,
        entry?.live ? 'Stream URL switched' : 'Stream URL saved',
        `\`${parsed.toString()}\`\n\n${
          entry?.live
            ? 'Reloading the page in the guest browser now.'
            : 'Use `.join` to go live with this page.'
        }`
      )
    );
  },
};
