const express = require('express');
const { chat, clearChat } = require('../services/chatService');

const router = express.Router();

router.post('/', async (req, res) => {
  const { message, sessionId = 'default' } = req.body;

  if (!message || message.trim().length === 0) {
    return res.status(400).json({ error: 'Message is required' });
  }

  const result = await chat(message, sessionId);

  if (result.error && !result.reply) {
    return res.status(503).json({ error: result.error, reply: null });
  }

  res.json({ reply: result.reply });
});

router.post('/clear', (req, res) => {
  const { sessionId = 'default' } = req.body;
  const result = clearChat(sessionId);
  res.json(result);
});

module.exports = router;
