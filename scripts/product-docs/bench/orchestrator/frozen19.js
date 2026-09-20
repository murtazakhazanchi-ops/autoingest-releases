'use strict';
// Adapter: re-exports the existing frozen-19 conversation set (unmodified,
// unchanged wording) as a plain array, matching runConversations.js's
// expected module shape. The frozen set itself is not touched.
const { CONVERSATIONS } = require('../bakeoff/conversationTrial');
module.exports = CONVERSATIONS;
