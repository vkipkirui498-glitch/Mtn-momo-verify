# Demo Verification + Telegram Approval

An independent demo login flow with a phone-number screen, five-digit demo-code UI, waiting spinner, Telegram Approve/Decline buttons, retry on decline, and success screen on approval.

This project is not affiliated with MTN or a mobile-money provider. It never sends or stores the demo code and must not be used to collect real financial PINs.

## Run locally

1. Install Node.js 18 or later.
2. Run `npm install`.
3. Configure `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` as environment variables.
4. Run `npm start` and open the URL printed by the server.

Without Telegram configuration, the server returns an explicit configuration error instead of pretending that approval is working.

## Render setup

- Build command: `npm install`
- Start command: `npm start`
- Add environment variables `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` in the Render service settings.
- Use a dedicated Telegram bot for this app because the server uses Telegram long polling and removes any configured webhook for that bot.

## Security notes

- Telegram receives a request ID, masked phone number, timestamp, the fixed display label `00000`, and Approve/Decline buttons. The label is not the visitor-entered code.
- The five-digit demo test entry is checked in the browser only. The browser sends only a boolean indicating that five digits were entered; the entered digits are never sent to the server or Telegram.
- Requests expire after 10 minutes and are held in memory, so pending requests are lost if the service restarts or scales to multiple instances. Use a persistent store and authenticated admin identity for production.
