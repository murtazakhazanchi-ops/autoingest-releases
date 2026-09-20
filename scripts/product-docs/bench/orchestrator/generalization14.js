'use strict';
// Adapter: re-exports the existing generalization-14 conversation set
// (unmodified, unchanged wording) as a plain array, matching
// runConversations.js's expected module shape. The set itself is not touched.
const { GENERALIZATION_CONVERSATIONS } = require('../candidateC/generalizationSet');
module.exports = GENERALIZATION_CONVERSATIONS;
