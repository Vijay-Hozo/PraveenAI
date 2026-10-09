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

This project was created using `bun init` in bun v1.3.14. [Bun](https://bun.com) is a fast all-in-one JavaScript runtime.
