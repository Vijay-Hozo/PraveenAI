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
