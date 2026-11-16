'use strict';

const mongoose = require('mongoose');
const { createChatModels } = require('./chat-models.cjs');

function publicMessage(row) {
  return {
    id: String(row._id), clientMessageId: row.clientMessageId,
    role: row.role, text: row.text, createdAt: row.createdAt,
  };
}

async function connectChatStore() {
  // This lesson intentionally cannot target another database or a remote MongoDB host.
  const connection = await mongoose.createConnection('mongodb://127.0.0.1:27017/mern_ai_course', {
    serverSelectionTimeoutMS: 5000, bufferCommands: false,
  }).asPromise();
  try {
    const { Conversation, Message } = createChatModels(connection);
    await Promise.all([Conversation.init(), Message.init()]);
    return {
      ready: () => connection.readyState === 1,
      close: () => connection.close(),
      create: async tokenHash => {
        const row = await Conversation.create({ tokenHash, provider: 'storage-only' });
        return { id: String(row._id), provider: row.provider };
      },
      authorize: (id, tokenHash) => Conversation.exists({ _id: id, tokenHash }),
      async append(conversationId, clientMessageId, text) {
        const key = { conversationId, clientMessageId };
        let row;
        let replayed = false;
        try {
          row = await Message.create({ ...key, role: 'user', text });
        } catch (error) {
          if (error.code !== 11000) throw error;
          row = await Message.findOne(key).lean();
          if (!row) throw error;
          replayed = true;
        }
        // Reusing an id for different content is a conflict, never a silent overwrite.
        return row.text !== text ? { conflict: true } : { message: publicMessage(row), replayed };
      },
      async history(conversationId, before, limit) {
        const filter = { conversationId };
        if (before) filter._id = { $lt: new mongoose.Types.ObjectId(before) };
        const rows = await Message.find(filter).sort({ _id: -1 }).limit(limit + 1).lean();
        const hasMore = rows.length > limit;
        const page = rows.slice(0, limit);
        return {
          messages: page.map(publicMessage).reverse(),
          nextBefore: hasMore ? String(page[page.length - 1]._id) : null,
        };
      },
    };
  } catch (error) {
    await connection.close();
    throw error;
  }
}

module.exports = { connectChatStore };
