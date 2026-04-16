const { Mistral } = require('@mistralai/mistralai');

const mistral = process.env.MISTRAL_API_KEY ? new Mistral({ apiKey: process.env.MISTRAL_API_KEY }) : null;

const SYSTEM_PROMPT = `You are a concise transit assistant for Tirana's public transport system.

STRICT RULES:
- Keep all responses under 80 words
- Never repeat information already stated
- Answer only what is directly asked — no suggestions, no filler, no disclaimers
- If the answer is a list, use max 5 items
- Never greet the user or say goodbye
- Never explain what you are about to do, just do it
- If asked something outside transit (stops, routes, schedules, directions), reply: "I only handle Tirana transit queries."`;

const chatHistories = new Map();

async function chat(message, sessionId = 'default') {
  if (!message || message.trim().length === 0) {
    return { error: 'Message is required', reply: null };
  }

  if (!mistral) {
    return {
      error: 'Chatbot not configured',
      reply: 'The AI chatbot is currently unavailable. Please check back later or use the route planner for transit information.'
    };
  }

  let history = chatHistories.get(sessionId);
  if (!history) {
    history = [];
    chatHistories.set(sessionId, history);
  }

  const messages = [
    { role: 'system', content: SYSTEM_PROMPT },
    ...history.map(h => ({ role: h.role === 'model' ? 'assistant' : 'user', content: h.text })),
    { role: 'user', content: message }
  ];

  const completion = await mistral.chat.complete({
    model: 'mistral-small-latest',
    messages: messages,
    maxTokens: 500,
    temperature: 0.7,
  });

  const reply = completion.choices[0]?.message?.content || 'Sorry, I could not generate a response.';

  history.push({ role: 'user', text: message });
  history.push({ role: 'model', text: reply });

  if (history.length > 20) {
    chatHistories.set(sessionId, history.slice(-20));
  }

  return { reply, error: null };
}

function clearChat(sessionId = 'default') {
  chatHistories.delete(sessionId);
  return { success: true };
}

module.exports = { chat, clearChat };
