import { join } from "node:path";
import type { Bot } from "grammy";
import type { InlineQueryResultArticle } from "grammy/types";
import { validateInitData, type WebAppInitData } from "./auth";
import {
  searchFlights,
  resolveAirportCode,
  type FlightOffer,
} from "../services/flights/duffel";
import {
  searchHotels,
  prebookHotel,
  bookHotel,
  isLiteApiSandbox,
  type HotelGuest,
  type HotelOffer,
  type HotelPrebook,
} from "../services/hotels/liteapi";
import {
  AREA_NAMES,
  STATUS_TIMELINE,
  getMenu,
  orderStatus,
  placeOrder,
  resolveArea,
  searchRestaurants,
  type FoodOrder,
} from "../services/food";
import { escapeHtml, formatFlightDateTime, nightsBetween } from "../utils/format";

const publicDir = join(import.meta.dir, "..", "..", "public", "miniapp");
const staticFiles: Record<string, string> = {
  "/": "index.html",
  "/index.html": "index.html",
  "/app.js": "app.js",
  "/styles.css": "styles.css",
};

// Offers live only in memory, like the chat flow's offer maps.
const flightOffers = new Map<string, FlightOffer>();
const hotelOffers = new Map<string, HotelOffer>();
const prebooks = new Map<string, { userId: number; offer: HotelOffer; prebook: HotelPrebook }>();
const foodOrders = new Map<string, FoodOrder>();

class HttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

const isoDate = /^\d{4}-\d{2}-\d{2}$/;

function json(data: unknown, status = 200): Response {
  return Response.json(data, { status, headers: { "Cache-Control": "no-store" } });
}

function requireString(value: unknown, name: string, maxLength = 100): string {
  if (typeof value !== "string" || !value.trim() || value.length > maxLength) {
    throw new HttpError(400, `${name} is required`);
  }
  return value.trim();
}

function requireDate(value: unknown, name: string): string {
  const date = requireString(value, name, 10);
  if (!isoDate.test(date)) throw new HttpError(400, `${name} must be YYYY-MM-DD`);
  return date;
}

function requireCount(value: unknown, name: string, max: number): number {
  const count = Number(value);
  if (!Number.isInteger(count) || count < 1 || count > max) {
    throw new HttpError(400, `${name} must be between 1 and ${max}`);
  }
  return count;
}

function upstreamError(error: unknown): HttpError {
  console.error("Mini App upstream error:", error);
  const details = error instanceof Error
    ? error.message.replace(/^Error:\s*/, "").slice(0, 300)
    : "Unknown error";
  return new HttpError(502, details);
}

async function resolveAirport(location: string): Promise<string> {
  const code = await resolveAirportCode(location).catch((error) => {
    throw upstreamError(error);
  });
  if (!code) throw new HttpError(400, `Couldn't find an airport for "${location}"`);
  return code;
}

function flightSummaryHtml(offer: FlightOffer): string {
  return [
    `<b>✈️ ${escapeHtml(offer.airline)}</b>`,
    `${escapeHtml(formatFlightDateTime(offer.departure))} → ${escapeHtml(formatFlightDateTime(offer.arrival))}`,
    `${offer.stops === 0 ? "Direct" : `${offer.stops} stop(s)`}${offer.duration ? ` · ${escapeHtml(offer.duration)}` : ""}`,
    `<b>${escapeHtml(offer.totalCurrency)} ${escapeHtml(offer.totalAmount)}</b>`,
  ].join("\n");
}

function hotelSummaryHtml(offer: HotelOffer, price = offer.totalAmount, currency = offer.totalCurrency): string {
  const nights = nightsBetween(offer.checkin, offer.checkout);
  return [
    `<b>🏨 ${escapeHtml(offer.hotelName)}</b>`,
    offer.address ? escapeHtml(offer.address) : undefined,
    `${escapeHtml(offer.roomName)}${offer.boardName ? ` · ${escapeHtml(offer.boardName)}` : ""}`,
    `${escapeHtml(offer.checkin)} → ${escapeHtml(offer.checkout)} · ${nights} ${nights === 1 ? "night" : "nights"}`,
    `<b>${escapeHtml(currency)} ${price.toFixed(2)}</b>`,
  ].filter(Boolean).join("\n");
}

function foodOrderHtml(order: FoodOrder): string {
  return [
    `<b>🍽 ${escapeHtml(order.restaurantName)}</b>`,
    ...order.lines.map((line) => `${line.quantity} × ${escapeHtml(line.name)} · ${order.currency} ${line.total.toFixed(2)}`),
    `Delivery to ${escapeHtml(order.delivery.address)}, ${escapeHtml(order.area)}`,
    `<b>Total ${order.currency} ${order.total.toFixed(2)}</b> (cash on delivery)`,
  ].join("\n");
}

// Posts the simulated status changes to the chat as the order progresses.
function scheduleFoodUpdates(bot: Bot, order: FoodOrder) {
  for (const step of STATUS_TIMELINE) {
    if (step.status !== "out_for_delivery" && step.status !== "delivered") continue;
    setTimeout(() => {
      const emoji = step.status === "delivered" ? "✅" : "🛵";
      bot.api.sendMessage(
        order.userId,
        `${emoji} <b>${escapeHtml(step.label)}</b>\n${escapeHtml(order.restaurantName)} · Order <code>${escapeHtml(order.orderId)}</code>`,
        { parse_mode: "HTML" },
      ).catch((error) => console.error("Food status message error:", error));
    }, step.afterSeconds * 1000);
  }
}

function article(id: string, title: string, description: string, html: string): InlineQueryResultArticle {
  return {
    type: "article",
    id,
    title,
    description,
    input_message_content: { message_text: html, parse_mode: "HTML" },
  };
}

type ApiHandler = (body: Record<string, unknown>, auth: WebAppInitData, bot: Bot) => Promise<unknown>;

const api: Record<string, ApiHandler> = {
  "/api/config": async () => ({
    hotelBookingEnabled: Boolean(process.env.LITEAPI_KEY) && isLiteApiSandbox(),
  }),

  "/api/flights/search": async (body) => {
    const [origin, destination] = await Promise.all([
      resolveAirport(requireString(body.origin, "origin")),
      resolveAirport(requireString(body.destination, "destination")),
    ]);
    if (origin === destination) throw new HttpError(400, "Departure and arrival airports must be different");

    const departureDate = requireDate(body.departureDate, "departureDate");
    const returnDate = body.returnDate ? requireDate(body.returnDate, "returnDate") : undefined;
    const passengers = requireCount(body.passengers ?? 1, "passengers", 6);

    const offers = await searchFlights({ origin, destination, departureDate, returnDate, passengers })
      .catch((error) => { throw upstreamError(error); });
    for (const offer of offers) flightOffers.set(offer.id, offer);

    return { origin, destination, offers };
  },

  // Sends the chosen flight into the chat. With a query_id (inline or menu
  // button launch) answerWebAppQuery posts it and Telegram closes the app.
  "/api/flights/select": async (body, auth, bot) => {
    const offer = flightOffers.get(requireString(body.offerId, "offerId", 200));
    if (!offer) throw new HttpError(404, "That flight option has expired. Please search again.");

    const html =
      `<b>Flight selected</b>\n${flightSummaryHtml(offer)}\n\n` +
      "This is Duffel test mode. To create the booking, the next step needs passenger names, date of birth, contact details, and payment information.";

    if (auth.queryId) {
      await bot.api.answerWebAppQuery(
        auth.queryId,
        article(offer.id.slice(0, 64), `${offer.airline} · ${offer.totalCurrency} ${offer.totalAmount}`, "Flight selected", html),
      );
      return { sentVia: "web_app_query" };
    }

    await bot.api.sendMessage(auth.user.id, html, { parse_mode: "HTML" });
    return { sentVia: "message" };
  },

  "/api/hotels/search": async (body) => {
    const destination = requireString(body.destination, "destination");
    const checkin = requireDate(body.checkin, "checkin");
    const checkout = requireDate(body.checkout, "checkout");
    const adults = requireCount(body.adults ?? 1, "adults", 4);
    if (nightsBetween(checkin, checkout) < 1) throw new HttpError(400, "Check-out must be after check-in");

    const offers = await searchHotels({ destination, checkin, checkout, adults })
      .catch((error) => { throw upstreamError(error); });

    // LiteAPI offer IDs are long, so the app references them by short keys.
    return {
      offers: offers.map((offer) => {
        const key = crypto.randomUUID().slice(0, 12);
        hotelOffers.set(key, offer);
        const { offerId: _offerId, ...publicOffer } = offer;
        return { key, ...publicOffer };
      }),
    };
  },

  "/api/hotels/prebook": async (body, auth) => {
    const offer = hotelOffers.get(requireString(body.key, "key"));
    if (!offer) throw new HttpError(404, "That hotel option has expired. Please search again.");

    const prebook = await prebookHotel(offer.offerId).catch((error) => { throw upstreamError(error); });
    prebooks.set(prebook.prebookId, { userId: auth.user.id, offer, prebook });

    return prebook;
  },

  "/api/hotels/book": async (body, auth, bot) => {
    const held = prebooks.get(requireString(body.prebookId, "prebookId", 200));
    if (!held || held.userId !== auth.user.id) {
      throw new HttpError(404, "This hotel booking has expired. Please search again.");
    }

    const guestBody = (body.guest ?? {}) as Record<string, unknown>;
    const guest: HotelGuest = {
      firstName: requireString(guestBody.firstName, "firstName", 60),
      lastName: requireString(guestBody.lastName, "lastName", 60),
      email: requireString(guestBody.email, "email", 120),
    };
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(guest.email)) throw new HttpError(400, "Enter a valid email");

    const booking = await bookHotel(held.prebook.prebookId, guest).catch((error) => { throw upstreamError(error); });
    prebooks.delete(held.prebook.prebookId);

    await bot.api.sendMessage(
      auth.user.id,
      `<b>✅ Hotel booking ${escapeHtml(booking.status.toLowerCase())}</b>\n` +
      `${hotelSummaryHtml(held.offer, held.prebook.price, held.prebook.currency)}\n` +
      `Guest: ${escapeHtml(`${guest.firstName} ${guest.lastName}`)}\n` +
      `Booking ID: <code>${escapeHtml(booking.bookingId)}</code>\n` +
      (booking.hotelConfirmationCode
        ? `Hotel confirmation: <code>${escapeHtml(booking.hotelConfirmationCode)}</code>\n`
        : "") +
      (isLiteApiSandbox() ? "\nThis is a LiteAPI sandbox booking. No real reservation or payment was made." : ""),
      { parse_mode: "HTML" },
    ).catch((error) => console.error("Mini App booking message error:", error));

    return booking;
  },

  "/api/food/areas": async () => ({ areas: AREA_NAMES }),

  "/api/food/restaurants": async (body) => {
    const input = requireString(body.area, "area");
    const area = resolveArea(input);
    if (!area) throw new HttpError(400, `We don't deliver to "${input}" yet. Try ${AREA_NAMES.slice(0, 3).join(", ")}…`);
    const query = typeof body.query === "string" ? body.query.slice(0, 60) : undefined;
    return { area: area.name, ...await searchRestaurants({ area, query }) };
  },

  "/api/food/menu": async (body) => {
    const result = await getMenu(requireString(body.restaurantId, "restaurantId", 40))
      .catch((error) => { throw upstreamError(error); });
    if (!result) throw new HttpError(404, "This restaurant is no longer listed. Please search again.");
    return result;
  },

  "/api/food/order": async (body, auth, bot) => {
    const rawLines = Array.isArray(body.lines) ? body.lines.slice(0, 30) : [];
    const lines = rawLines.map((line: Record<string, unknown>) => ({
      itemId: requireString(line?.itemId, "itemId", 80),
      quantity: requireCount(line?.quantity, "quantity", 20),
    }));

    const deliveryBody = (body.delivery ?? {}) as Record<string, unknown>;
    const delivery = {
      name: requireString(deliveryBody.name, "name", 60),
      phone: requireString(deliveryBody.phone, "phone", 20),
      address: requireString(deliveryBody.address, "address", 200),
      notes: typeof deliveryBody.notes === "string" ? deliveryBody.notes.trim().slice(0, 200) || undefined : undefined,
    };
    if (!/^\+?[\d\s-]{7,20}$/.test(delivery.phone)) throw new HttpError(400, "Enter a valid phone number");

    const area = resolveArea(requireString(body.area, "area"));
    if (!area) throw new HttpError(400, "Unknown delivery area");

    const order = await placeOrder({
      userId: auth.user.id,
      restaurantId: requireString(body.restaurantId, "restaurantId", 40),
      area: area.name,
      lines,
      delivery,
    }).catch((error) => { throw new HttpError(400, error instanceof Error ? error.message : "Couldn't place the order"); });
    foodOrders.set(order.orderId, order);

    await bot.api.sendMessage(
      auth.user.id,
      `<b>🧾 Order placed</b>\n${foodOrderHtml(order)}\n` +
      `Order ID: <code>${escapeHtml(order.orderId)}</code> · ETA ${order.etaMinutes} min\n\n` +
      "This is a test order. No food is prepared and no payment is taken.",
      { parse_mode: "HTML" },
    ).catch((error) => console.error("Mini App food message error:", error));
    scheduleFoodUpdates(bot, order);

    return { ...order, ...orderStatus(order) };
  },

  "/api/food/status": async (body, auth) => {
    const order = foodOrders.get(requireString(body.orderId, "orderId", 40));
    if (!order || order.userId !== auth.user.id) throw new HttpError(404, "Order not found");
    return orderStatus(order);
  },

  // Prepares a message the user can forward with WebApp.shareMessage().
  "/api/share": async (body, auth, bot) => {
    let result: InlineQueryResultArticle;

    if (body.type === "flight") {
      const offer = flightOffers.get(requireString(body.offerId, "offerId", 200));
      if (!offer) throw new HttpError(404, "That flight option has expired.");
      result = article(crypto.randomUUID(), `${offer.airline} flight`, `${offer.totalCurrency} ${offer.totalAmount}`, flightSummaryHtml(offer));
    } else if (body.type === "hotel") {
      const offer = hotelOffers.get(requireString(body.key, "key"));
      if (!offer) throw new HttpError(404, "That hotel option has expired.");
      result = article(crypto.randomUUID(), offer.hotelName, `${offer.totalCurrency} ${offer.totalAmount.toFixed(2)}`, hotelSummaryHtml(offer));
    } else {
      throw new HttpError(400, "type must be flight or hotel");
    }

    const prepared = await bot.api.savePreparedInlineMessage(auth.user.id, result, {
      allow_user_chats: true,
      allow_group_chats: true,
      allow_channel_chats: true,
    });
    return { id: prepared.id };
  },
};

async function handleApi(request: Request, handler: ApiHandler, bot: Bot, botToken: string): Promise<Response> {
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const authorization = request.headers.get("Authorization") ?? "";
  const auth = authorization.startsWith("tma ")
    ? validateInitData(authorization.slice(4), botToken)
    : undefined;
  if (!auth) return json({ error: "Open this app from Telegram." }, 401);

  try {
    const body = await request.json().catch(() => ({})) as Record<string, unknown>;
    return json(await handler(body ?? {}, auth, bot));
  } catch (error) {
    if (error instanceof HttpError) return json({ error: error.message }, error.status);
    console.error("Mini App API error:", error);
    return json({ error: "Something went wrong. Please try again." }, 500);
  }
}

export function startMiniAppServer(bot: Bot, botToken: string, port: number) {
  return Bun.serve({
    port,
    // Bun closes connections idle for 10s by default, which cuts off slow
    // upstream calls (flight offers, OpenStreetMap). Bun allows up to 255s.
    idleTimeout: 120,
    async fetch(request) {
      const { pathname } = new URL(request.url);

      const handler = api[pathname];
      if (handler) return handleApi(request, handler, bot, botToken);

      const file = staticFiles[pathname];
      if (file) return new Response(Bun.file(join(publicDir, file)));

      return new Response("Not found", { status: 404 });
    },
  });
}
