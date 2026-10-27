# propzingbot

To install dependencies:

```bash
bun install
```

To run:

```bash
bun run src/index.ts
```

## Flight search

The bot supports Duffel test-mode flight searches from Telegram:

```text
/flights ORIGIN DESTINATION YYYY-MM-DD [RETURN_DATE]
```

Example:

```text
/flights DEL BOM 2026-12-20 2026-12-27
```

Use three-letter IATA airport codes. The bot displays available offers with
price, airline, timing, duration, and stops, then lets the user select an
offer. The current flow stops before order creation because Duffel requires
passenger and payment details to book. It uses in-memory offer selection, so a
database is not required yet; Neon PostgreSQL can be added when passenger,
booking, or payment records need to persist.

Natural-language requests also work. For example, sending `Need to book
tickets from Chennai to Coimbatore` makes the bot ask for the departure date
and traveler count, then searches Duffel after those details are provided.

## LiteAPI hotel booking

Set `LITEAPI_KEY` in `.env` to enable hotel search and booking through
[LiteAPI](https://docs.liteapi.travel/). Optional `LITEAPI_CURRENCY` (default
`USD`) and `LITEAPI_GUEST_NATIONALITY` (default `AE`) control pricing.

```text
/bookhotel [DESTINATION]
/hotels DESTINATION CHECKIN CHECKOUT [ADULTS]
```

Example:

```text
/hotels Dubai 2026-12-20 2026-12-22 2
```

`/bookhotel` asks for the destination, check-in date, nights, and adults, then
lists the cheapest hotels. Selecting one prebooks the room to confirm the live
price, asks for the lead guest's name and email, and books after confirmation.
Natural-language requests such as `Book a hotel in Dubai Marina for 2 adults`
start the same flow.

Bookings are only enabled with a sandbox key (`sand_...`), which simulates
payment with no charge. A production key can search and prebook, but booking
stays disabled until a real payment flow (LiteAPI payment SDK) is added.

## Telegram Mini App

The bot ships a [Telegram Mini App](https://core.telegram.org/bots/webapps)
for searching flights and booking hotels. The bot process also starts an HTTP
server (`WEBAPP_PORT`, default `3000`) that serves `public/miniapp` and a small
JSON API under `/api`.

Telegram only opens Mini Apps over HTTPS, so expose the port with a tunnel and
set `WEBAPP_URL` to the public URL:

```bash
cloudflared tunnel --url http://localhost:3000
# then in .env:
WEBAPP_URL=https://<your-tunnel>.trycloudflare.com
```

With `WEBAPP_URL` set, the bot:

- sets the chat **menu button** to open the app (`setChatMenuButton`)
- adds **Search flights** and **Book hotels** inline `web_app` buttons to
  `/start` and `/app`
- offers a **Quick search** keyboard button in `/app`. Keyboard launches carry
  no user data, so the app sends the search back with `sendData` and the bot
  replies in the chat (`web_app_data`)
- answers inline queries with an **Open travel app** button (enable inline mode
  in @BotFather first)

Inside the app, choosing a flight posts it to the chat through
`answerWebAppQuery`. Hotels are prebooked and booked in the app, and the
confirmation is also sent to the chat. Offers can be forwarded to any chat with
`savePreparedInlineMessage` and `shareMessage`. The app uses Telegram's
MainButton, SecondaryButton, BackButton, SettingsButton (full screen, add to
home screen, clear data), haptic feedback, native popups, theme colors and
safe areas. Recent searches and guest details are stored in CloudStorage.

Every API request sends `Telegram.WebApp.initData`, and the server verifies its
HMAC-SHA256 signature with the bot token. Data older than 24 hours is
rejected.

To use direct links such as `t.me/<bot>/<app>?startapp=hotels`, register the
app with `/newapp` in @BotFather using the same URL. `startapp=hotels` opens
the Hotels tab and `startapp=food` opens the Food tab.

### Food ordering (test mode)

The **Food** tab simulates food delivery in Dubai. No public API lets third
parties place orders on Talabat, Careem or Deliveroo, so
`src/services/food/mock.ts` serves fictional restaurants and menus for areas
such as Dubai Marina, JLT, Downtown Dubai and Deira. Users pick an area, browse
restaurants, build a cart (one restaurant at a time, with minimum order,
delivery fee, AED 2 service fee and 5% VAT), enter delivery details and place a
cash-on-delivery test order.

The order then moves through placed → preparing → out for delivery →
delivered over about two minutes. The app shows the progress, and the bot posts
the confirmation and the rider/delivered updates to the chat. Orders are kept
in memory only. No food is ordered and nothing is charged. To use a real
provider later, replace `mock.ts` with a module that exports the same
functions.

## Browserbase page browsing

The bot can open a public HTTPS page in a short-lived Browserbase browser
session and return its readable text:

```text
/browse https://example.com
```

Set `BROWSERBASE_API_KEY` in `.env` before starting the bot. Browser sessions
are read-only, limited to 60 seconds, and do not record or log session
contents. Only public HTTPS URLs are accepted. The bot summarizes the page
into a short set of application-friendly bullet points instead of returning
the full extracted page text.

The bot runs on Bun, while the Browserbase Playwright CDP connection is
isolated in a small Node.js worker because Playwright CDP connections are not
reliable under Bun.

This project was created using `bun init` in bun v1.3.14. [Bun](https://bun.com) is a fast all-in-one JavaScript runtime.
