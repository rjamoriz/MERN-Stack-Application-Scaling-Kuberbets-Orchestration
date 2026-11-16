'use strict';

const mongoose = require('mongoose');

function createChatModels(connection) {
  const options = { strict: 'throw', timestamps: true, versionKey: false };
  const conversationSchema = new mongoose.Schema({
    tokenHash: { type: String, required: true, match: /^[a-f0-9]{64}$/, select: false },
    provider: { type: String, enum: ['storage-only'], required: true, immutable: true },
  }, { ...options, collection: 'lesson26_conversations' });

  // Separate documents avoid an ever-growing conversation array and MongoDB's 16 MB document limit.
  const messageSchema = new mongoose.Schema({
    conversationId: { type: mongoose.Schema.Types.ObjectId, required: true, immutable: true },
    clientMessageId: { type: String, required: true, match: /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/, immutable: true },
    role: { type: String, enum: ['user'], required: true, immutable: true },
    text: { type: String, required: true, trim: true, minlength: 1, maxlength: 2000, immutable: true },
  }, { ...options, collection: 'lesson26_messages' });
  // The database, not a preliminary existence check, arbitrates concurrent retries.
  messageSchema.index({ conversationId: 1, clientMessageId: 1 }, { unique: true });
  messageSchema.index({ conversationId: 1, _id: -1 });
  return {
    Conversation: connection.model('Lesson26Conversation', conversationSchema),
    Message: connection.model('Lesson26Message', messageSchema),
  };
}

module.exports = { createChatModels };
