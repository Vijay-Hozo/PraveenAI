
import "dotenv/config";
import { Bot } from "grammy";
import { InlineKeyboard } from "grammy";
import type { Context } from "grammy";
import { searchWeb } from "./services/brave";
import { generateAnswer, summarizeBrowserPage } from "./services/gemini";
import { browsePublicPage } from "./services/browserbase";
import {
  searchFlights,
  resolveAirportCode,
  type FlightOffer,
  type FlightSearch,
} from "./services/flights/duffel";
import {
  searchHotels,
  prebookHotel,
  bookHotel,
  isLiteApiSandbox,
  type HotelGuest,
  type HotelOffer,
  type HotelPrebook,
  type HotelSearch,
} from "./services/hotels/liteapi";
import { escapeHtml, formatFlightDateTime, nightsBetween } from "./utils/format";
import { startMiniAppServer } from "./webapp/server";

const token = process.env.TELEGRAM_BOT_TOKEN;

if (!token) {
  throw new Error("TELEGRAM_BOT_TOKEN is missing");
}

// Public HTTPS URL that serves public/miniapp (Telegram rejects plain HTTP).
const webAppUrl = process.env.WEBAPP_URL?.replace(/\/+$/, "");
const webAppPort = Number(process.env.WEBAPP_PORT || 3000);

const bot = new Bot(token);
const flightOffers = new Map<string, FlightOffer>();
type PendingFlight = Pick<FlightSearch, "origin" | "destination"> & {
  departureDate?: string;
  passengers?: number;
};

type BookFlightWizard = {
  origin?: string;
  destination?: string;
  departureDate?: string;
};

const pendingFlights = new Map<
  number,
  PendingFlight
>();
const bookFlightWizards = new Map<number, BookFlightWizard>();

type BookHotelWizard = Partial<HotelSearch> & {
  offer?: HotelOffer;
  prebook?: HotelPrebook;
  guest?: HotelGuest;
};

// LiteAPI offer IDs are too long for Telegram callback data, so buttons use short keys.
const hotelOffers = new Map<string, HotelOffer>();
const bookHotelWizards = new Map<number, BookHotelWizard>();

function formatForTelegram(answer: string): string {
  const protectedTags: string[] = [];
  const withoutTags = answer.replace(
    /<\/?(?:b|strong|i|em|u|s|code|pre|a\b[^>]*|br\s*\/?)>/gi,
    (tag) => {
      protectedTags.push(tag);
      return `@@TELEGRAM_HTML_${protectedTags.length - 1}@@`;
    },
  );

  const formattedAnswer = withoutTags
    .split("\n")
    .map((line) => {
      const isHeading = /^#{1,6}\s+/.test(line);
      let formatted = escapeHtml(line.replace(/^#{1,6}\s+/, ""));

      formatted = formatted.replace(
        /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
        '<a href="$2">$1</a>',
      );
      formatted = formatted.replace(/\*\*(.+?)\*\*/g, "<b>$1</b>");
      formatted = formatted.replace(/__(.+?)__/g, "<b>$1</b>");
      formatted = formatted.replace(/^-\s+/, "• ");

      return isHeading ? `<b>${formatted}</b>` : formatted;
    })
    .join("\n");

  return formattedAnswer.replace(
    /@@TELEGRAM_HTML_(\d+)@@/g,
    (_, index: string) => protectedTags[Number(index)] ?? "",
  );
}

async function sendFlightOffers(
  ctx: Context,
  search: FlightSearch,
): Promise<void> {
  await ctx.reply("✈️ Searching available test-mode flights...");

  try {
    const offers = await searchFlights(search);

    if (!offers.length) {
      await ctx.reply("No flights were found for those dates and airports.");
      return;
    }

    const keyboard = new InlineKeyboard();
    const message = offers.map((offer, index) => {
      flightOffers.set(offer.id, offer);
      keyboard.text(`Select ${index + 1}`, `flight:${offer.id}`).row();

      return [
        `<b>${index + 1}. ${escapeHtml(offer.airline)}</b>`,
        `${escapeHtml(formatFlightDateTime(offer.departure))} → ${escapeHtml(formatFlightDateTime(offer.arrival))}`,
        `${offer.stops === 0 ? "Direct" : `${offer.stops} stop(s)`}${offer.duration ? ` · ${escapeHtml(offer.duration)}` : ""}`,
        `<b>${escapeHtml(offer.totalCurrency)} ${escapeHtml(offer.totalAmount)}</b>`,
      ].join("\n");
    }).join("\n\n");

    await ctx.reply(message, {
      parse_mode: "HTML",
      reply_markup: keyboard,
    });
  } catch (error) {
    console.error("Flight search error:", error);
    const details = error instanceof Error
      ? error.message.replace(/^Error:\s*/, "").slice(0, 300)
      : "Unknown Duffel error";
    await ctx.reply(
      `Duffel could not search those flights. Please check the route and date.\n\n<code>${escapeHtml(details)}</code>`,
      { parse_mode: "HTML" },
    );
  }
}

function dateAsIso(date: Date): string {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

function dateLabel(date: Date): string {
  return date.toLocaleDateString("en-IN", {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
}

function datePickerKeyboard(callbackPrefix = "flight-date"): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  const today = new Date();

  for (let offset = 1; offset <= 30; offset += 1) {
    const date = new Date(today);
    date.setDate(today.getDate() + offset);
    keyboard.text(dateLabel(date), `${callbackPrefix}:${dateAsIso(date)}`);

    if (offset % 2 === 0) keyboard.row();
  }

  return keyboard;
}

function passengerKeyboard(): InlineKeyboard {
  const keyboard = new InlineKeyboard();

  for (let passengers = 1; passengers <= 6; passengers += 1) {
    keyboard.text(`${passengers} ${passengers === 1 ? "passenger" : "passengers"}`, `flight-passengers:${passengers}`);
    if (passengers % 2 === 0) keyboard.row();
  }

  return keyboard;
}

async function showDatePicker(ctx: Context): Promise<void> {
  await ctx.reply("📅 Choose your departure date, or type it as YYYY-MM-DD:", {
    reply_markup: datePickerKeyboard(),
  });
}

async function showPassengerPicker(ctx: Context): Promise<void> {
  await ctx.reply("👥 Choose the passenger count, or type a number from 1 to 6:", {
    reply_markup: passengerKeyboard(),
  });
}

async function tryResolveAirport(location: string): Promise<string | undefined> {
  try {
    return await resolveAirportCode(location);
  } catch (error) {
    console.error("Airport lookup error:", error);
    return undefined;
  }
}

async function parseNaturalFlightRoute(
  question: string,
): Promise<Pick<FlightSearch, "origin" | "destination"> | undefined> {
  const routeEnd = "(?=\\s+(?:at|on|by|for|with|tomorrow|cheapest|cheaper|lowest|flight|flights|ticket|tickets)\\b|$)";
  const route = question.match(
    new RegExp(`\\bfrom\\s+(.+?)\\s+to\\s+(.+?)${routeEnd}`, "i"),
  ) ?? question.match(
    new RegExp(`\\b(?:book|booking)\\s+(?:(?:a|the)\\s+)?(?:tickets?|flights?)?\\s*(.+?)\\s+to\\s+(.+?)${routeEnd}`, "i"),
  );

  if (!route) return undefined;

  const originName = route[1];
  const destinationName = route[2];
  if (!originName || !destinationName) return undefined;

  const [origin, destination] = await Promise.all([
    tryResolveAirport(originName),
    tryResolveAirport(destinationName),
  ]);

  return origin && destination ? { origin, destination } : undefined;
}

function parseDate(value: string): string | undefined {
  const relativeDate = value.match(/\b(day after tomorrow|tomorrow)\b/i);
  if (relativeDate) {
    const relativeDateLabel = relativeDate[1];
    if (!relativeDateLabel) return undefined;

    const date = new Date();
    date.setDate(date.getDate() + (relativeDateLabel.toLowerCase() === "tomorrow" ? 1 : 2));
    return dateAsIso(date);
  }

  const isoDate = value.match(/\b(\d{4}-\d{2}-\d{2})\b/);
  if (isoDate) return isoDate[1];

  const localDate = value.match(/\b(\d{1,2})[/-](\d{1,2})[/-](\d{4})\b/);
  if (localDate) {
    const day = localDate[1];
    const month = localDate[2];
    const year = localDate[3];
    if (!day || !month || !year) return undefined;

    return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
  }

  const monthNames = [
    "january", "february", "march", "april", "may", "june",
    "july", "august", "september", "october", "november", "december",
  ];
  const namedDate = value.match(
    new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(${monthNames.join("|")})(?:\\s+(\\d{4}))?\\b`, "i"),
  );
  if (!namedDate) return undefined;

  const day = namedDate[1];
  const monthName = namedDate[2];
  const year = namedDate[3] ?? String(new Date().getUTCFullYear());
  if (!day || !monthName) return undefined;

  const month = monthNames.indexOf(monthName.toLowerCase()) + 1;
  return `${year}-${String(month).padStart(2, "0")}-${day.padStart(2, "0")}`;
}

function addNights(isoDate: string, nights: number): string {
  const date = new Date(`${isoDate}T00:00:00`);
  date.setDate(date.getDate() + nights);
  return dateAsIso(date);
}

function nightsKeyboard(): InlineKeyboard {
  const keyboard = new InlineKeyboard();

  for (let nights = 1; nights <= 10; nights += 1) {
    keyboard.text(`${nights} ${nights === 1 ? "night" : "nights"}`, `hotel-nights:${nights}`);
    if (nights % 2 === 0) keyboard.row();
  }

  return keyboard;
}

function hotelGuestsKeyboard(): InlineKeyboard {
  const keyboard = new InlineKeyboard();

  for (let adults = 1; adults <= 4; adults += 1) {
    keyboard.text(`${adults} ${adults === 1 ? "adult" : "adults"}`, `hotel-guests:${adults}`);
    if (adults % 2 === 0) keyboard.row();
  }

  return keyboard;
}

function parseHotelDestination(question: string): string | undefined {
  const destination = question.match(
    /\b(?:in|at|near)\s+(.+?)(?=\s+(?:from|on|for|with|between|checking|check-in|checkin|tomorrow|day after|\d)\b|[,.?!]|$)/i,
  );

  return destination?.[1]?.trim() || undefined;
}

function parseHotelGuest(value: string): HotelGuest | undefined {
  const email = value.match(/[^\s@]+@[^\s@]+\.[^\s@]+/)?.[0];
  if (!email) return undefined;

  const nameParts = value.replace(email, "").replace(/[,;]/g, " ").trim().split(/\s+/);
  const firstName = nameParts[0];
  const lastName = nameParts.slice(1).join(" ");

  return firstName && lastName ? { firstName, lastName, email } : undefined;
}

function hotelErrorDetails(error: unknown): string {
  return error instanceof Error
    ? error.message.replace(/^Error:\s*/, "").slice(0, 300)
    : "Unknown LiteAPI error";
}

async function sendHotelOffers(
  ctx: Context,
  search: HotelSearch,
): Promise<void> {
  await ctx.reply(`🏨 Searching hotels in ${search.destination}...`);

  try {
    const offers = await searchHotels(search);

    if (!offers.length) {
      await ctx.reply("No hotels were found for that destination and dates. Try another city or dates.");
      return;
    }

    const nights = nightsBetween(search.checkin, search.checkout);
    const keyboard = new InlineKeyboard();
    const message = offers.map((offer, index) => {
      const key = crypto.randomUUID().slice(0, 12);
      hotelOffers.set(key, offer);
      keyboard.text(`Select ${index + 1}`, `hotel:${key}`).row();

      const stars = offer.stars ? ` ${"⭐".repeat(Math.round(offer.stars))}` : "";
      const rating = offer.rating
        ? `Rated ${offer.rating}/10${offer.reviewCount ? ` (${offer.reviewCount} reviews)` : ""}`
        : undefined;

      return [
        `<b>${index + 1}. ${escapeHtml(offer.hotelName)}</b>${stars}`,
        offer.address ? escapeHtml(offer.address) : undefined,
        rating,
        `${escapeHtml(offer.roomName)}${offer.boardName ? ` · ${escapeHtml(offer.boardName)}` : ""}`,
        offer.refundable ? "Refundable" : "Non-refundable",
        `<b>${escapeHtml(offer.totalCurrency)} ${offer.totalAmount.toFixed(2)}</b> for ${nights} ${nights === 1 ? "night" : "nights"}`,
      ].filter(Boolean).join("\n");
    }).join("\n\n");

    await ctx.reply(
      `<b>Hotels in ${escapeHtml(search.destination)}</b>\n` +
      `${escapeHtml(search.checkin)} → ${escapeHtml(search.checkout)} · ${search.adults} ${search.adults === 1 ? "adult" : "adults"}\n\n` +
      message,
      {
        parse_mode: "HTML",
        reply_markup: keyboard,
      },
    );
  } catch (error) {
    console.error("Hotel search error:", error);
    await ctx.reply(
      `LiteAPI could not search those hotels. Please check the destination and dates.\n\n<code>${escapeHtml(hotelErrorDetails(error))}</code>`,
      { parse_mode: "HTML" },
    );
  }
}

async function continueHotelWizard(
  ctx: Context,
  wizard: BookHotelWizard,
): Promise<void> {
  if (!wizard.destination) {
    await ctx.reply("🏨 Which city or area do you want to stay in?\nExample: Dubai Marina");
    return;
  }

  if (!wizard.checkin) {
    await ctx.reply("📅 Choose your check-in date, or type it as YYYY-MM-DD:", {
      reply_markup: datePickerKeyboard("hotel-checkin"),
    });
    return;
  }

  if (!wizard.checkout) {
    await ctx.reply("🌙 How many nights? Choose below, or type the check-out date as YYYY-MM-DD:", {
      reply_markup: nightsKeyboard(),
    });
    return;
  }

  if (!wizard.adults) {
    await ctx.reply("👥 How many adults? Choose below, or type a number from 1 to 4:", {
      reply_markup: hotelGuestsKeyboard(),
    });
    return;
  }

  await sendHotelOffers(ctx, wizard as HotelSearch);
}

function startHotelWizard(chatId: number, wizard: BookHotelWizard = {}): BookHotelWizard {
  bookFlightWizards.delete(chatId);
  pendingFlights.delete(chatId);
  bookHotelWizards.set(chatId, wizard);
  return wizard;
}

function miniAppKeyboard(): InlineKeyboard | undefined {
  // web_app inline buttons only work in private chats.
  return webAppUrl
    ? new InlineKeyboard()
      .webApp("✈️ Search flights", webAppUrl)
      .webApp("🏨 Book hotels", `${webAppUrl}/?tab=hotels`)
    : undefined;
}

bot.command("start", async (ctx) => {
  await ctx.reply(
    "Hello! I'm your travel agent.\n\n" +
    "Ask me to find flights, hotels, or travel options. " +
    "Use /bookflight for a guided flight search or /bookhotel to book a hotel." +
    (webAppUrl ? "\n\nOr open the travel app below." : ""),
    { reply_markup: ctx.chat.type === "private" ? miniAppKeyboard() : undefined },
  );
});

bot.command("app", async (ctx) => {
  if (!webAppUrl) {
    await ctx.reply("The travel app isn't configured yet. Set WEBAPP_URL to a public HTTPS URL.");
    return;
  }

  if (ctx.chat.type !== "private") {
    await ctx.reply(`Open the travel app in a private chat with @${ctx.me.username}.`);
    return;
  }

  await ctx.reply("Search and book in the travel app:", { reply_markup: miniAppKeyboard() });
  // A keyboard-button launch can't call the API, so the app sends the search back with sendData.
  await ctx.reply("Or use quick search from the keyboard below. Results arrive in this chat.", {
    reply_markup: {
      keyboard: [[{ text: "🔎 Quick search", web_app: { url: webAppUrl } }]],
      resize_keyboard: true,
      is_persistent: false,
    },
  });
});

type WebAppSearch =
  | { type: "flight_search"; origin?: string; destination?: string; departureDate?: string; returnDate?: string; passengers?: number }
  | { type: "hotel_search"; destination?: string; checkin?: string; checkout?: string; adults?: number };

bot.on("message:web_app_data", async (ctx) => {
  let search: WebAppSearch;
  try {
    search = JSON.parse(ctx.message.web_app_data.data);
  } catch {
    await ctx.reply("I couldn't read that search. Please try again.");
    return;
  }

  const isoDate = /^\d{4}-\d{2}-\d{2}$/;

  if (search.type === "flight_search") {
    if (!search.origin || !search.destination || !isoDate.test(search.departureDate ?? "")) {
      await ctx.reply("That flight search is missing the route or date. Please try again.");
      return;
    }

    const [origin, destination] = await Promise.all([
      tryResolveAirport(search.origin),
      tryResolveAirport(search.destination),
    ]);
    if (!origin || !destination || origin === destination) {
      await ctx.reply("I couldn't find those airports. Please try a city name or 3-letter airport code.");
      return;
    }

    bookHotelWizards.delete(ctx.chat.id);
    await sendFlightOffers(ctx, {
      origin,
      destination,
      departureDate: search.departureDate!,
      returnDate: isoDate.test(search.returnDate ?? "") ? search.returnDate : undefined,
      passengers: Math.min(Math.max(Number(search.passengers) || 1, 1), 6),
    });
    return;
  }

  if (search.type === "hotel_search") {
    const { destination, checkin, checkout } = search;
    if (!destination || !checkin || !checkout || !isoDate.test(checkin) || !isoDate.test(checkout) ||
        nightsBetween(checkin, checkout) < 1) {
      await ctx.reply("That hotel search is missing the destination or dates. Please try again.");
      return;
    }

    const hotelSearch: HotelSearch = {
      destination: destination.slice(0, 100),
      checkin,
      checkout,
      adults: Math.min(Math.max(Number(search.adults) || 1, 1), 4),
    };
    startHotelWizard(ctx.chat.id, hotelSearch);
    await sendHotelOffers(ctx, hotelSearch);
    return;
  }

  await ctx.reply("I couldn't read that search. Please try again.");
});

// Inline mode (enable it in @BotFather) offers a button that opens the Mini App.
bot.on("inline_query", async (ctx) => {
  if (!webAppUrl) {
    await ctx.answerInlineQuery([], { cache_time: 0 });
    return;
  }

  await ctx.answerInlineQuery([], {
    cache_time: 0,
    is_personal: true,
    button: { text: "✈️ Open travel app", web_app: { url: webAppUrl } },
  });
});

bot.command("help", async (ctx) => {
  await ctx.reply(
    "Ask me about flights, hotels, destinations, or travel plans.\n" +
    "I'll find options and guide you toward the next action.\n\n" +
    "Book a flight step by step with /bookflight\n" +
    "Book a hotel step by step with /bookhotel\n" +
    "Open the travel app with /app\n" +
    "Browse a public page with /browse https://example.com\n" +
    "For flights, use:\n" +
    "/flights DEL BOM 2026-12-20\n" +
    "For hotels, use:\n" +
    "/hotels Dubai 2026-12-20 2026-12-22 2"
  );
});

bot.command("bookhotel", async (ctx) => {
  const text = (ctx.message?.text ?? "")
    .replace(/^\/bookhotel(?:@\w+)?\s*/i, "")
    .trim();
  const wizard = startHotelWizard(ctx.chat.id);

  if (text) {
    wizard.destination = parseHotelDestination(` in ${text}`) ?? text;
    wizard.checkin = parseDate(text);
    const adults = text.match(/\b(\d+)\s+(?:adult|adults|guest|guests|people|persons)\b/i)?.[1];
    if (adults) wizard.adults = Number(adults);
  }

  await continueHotelWizard(ctx, wizard);
});

bot.command("hotels", async (ctx) => {
  const input = (ctx.message?.text ?? "")
    .replace(/^\/hotels(?:@\w+)?\s*/i, "")
    .trim();
  const match = input.match(/^(.+?)\s+(\d{4}-\d{2}-\d{2})\s+(\d{4}-\d{2}-\d{2})(?:\s+(\d+))?$/);

  if (!match?.[1] || !match[2] || !match[3]) {
    await ctx.reply(
      "Use this format:\n/hotels DESTINATION CHECKIN CHECKOUT [ADULTS]\n\n" +
      "Example:\n/hotels Dubai 2026-12-20 2026-12-22 2",
    );
    return;
  }

  const search: HotelSearch = {
    destination: match[1],
    checkin: match[2],
    checkout: match[3],
    adults: Number(match[4] ?? 1),
  };

  if (nightsBetween(search.checkin, search.checkout) < 1) {
    await ctx.reply("Check-out must be after check-in.");
    return;
  }

  startHotelWizard(ctx.chat.id, search);
  await sendHotelOffers(ctx, search);
});

bot.callbackQuery(/^hotel-checkin:(\d{4}-\d{2}-\d{2})$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const chatId = ctx.chat?.id;
  const wizard = chatId ? bookHotelWizards.get(chatId) : undefined;

  if (!chatId || !wizard) {
    await ctx.reply("This hotel search has expired. Please run /bookhotel again.");
    return;
  }

  wizard.checkin = ctx.match[1];
  wizard.checkout = undefined;
  await continueHotelWizard(ctx, wizard);
});

bot.callbackQuery(/^hotel-nights:(\d+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const chatId = ctx.chat?.id;
  const wizard = chatId ? bookHotelWizards.get(chatId) : undefined;

  if (!chatId || !wizard?.checkin) {
    await ctx.reply("This hotel search has expired. Please run /bookhotel again.");
    return;
  }

  wizard.checkout = addNights(wizard.checkin, Number(ctx.match[1]));
  await continueHotelWizard(ctx, wizard);
});

bot.callbackQuery(/^hotel-guests:(\d+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const chatId = ctx.chat?.id;
  const wizard = chatId ? bookHotelWizards.get(chatId) : undefined;

  if (!chatId || !wizard) {
    await ctx.reply("This hotel search has expired. Please run /bookhotel again.");
    return;
  }

  wizard.adults = Number(ctx.match[1]);
  await continueHotelWizard(ctx, wizard);
});

bot.callbackQuery(/^hotel:(.+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const chatId = ctx.chat?.id;
  const offerKey = ctx.match[1];
  const offer = offerKey ? hotelOffers.get(offerKey) : undefined;

  if (!chatId || !offer) {
    await ctx.reply("That hotel option has expired. Please search again with /bookhotel.");
    return;
  }

  await ctx.reply("⏳ Checking that the room is still available...");

  try {
    const prebook = await prebookHotel(offer.offerId);
    const wizard = bookHotelWizards.get(chatId) ?? startHotelWizard(chatId, {
      destination: offer.hotelName,
      checkin: offer.checkin,
      checkout: offer.checkout,
      adults: offer.adults,
    });
    wizard.offer = offer;
    wizard.prebook = prebook;
    wizard.guest = undefined;

    const changes = [
      prebook.priceChanged ? "⚠️ The price changed since your search." : undefined,
      prebook.cancellationChanged ? "⚠️ The cancellation terms changed since your search." : undefined,
    ].filter(Boolean).join("\n");

    await ctx.reply(
      `<b>Room held: ${escapeHtml(offer.hotelName)}</b>\n` +
      `${escapeHtml(offer.roomName)}\n` +
      `${escapeHtml(offer.checkin)} → ${escapeHtml(offer.checkout)} · ${offer.adults} ${offer.adults === 1 ? "adult" : "adults"}\n` +
      `${offer.refundable ? "Refundable" : "Non-refundable"}\n` +
      `<b>${escapeHtml(prebook.currency)} ${prebook.price.toFixed(2)}</b>\n` +
      (changes ? `\n${changes}\n` : "") +
      "\nPlease send the lead guest's full name and email.\nExample: John Smith john@example.com",
      {
        parse_mode: "HTML",
        reply_markup: new InlineKeyboard().text("Cancel", "hotel-cancel"),
      },
    );
  } catch (error) {
    console.error("Hotel prebook error:", error);
    await ctx.reply(
      `That room is no longer available. Please choose another option.\n\n<code>${escapeHtml(hotelErrorDetails(error))}</code>`,
      { parse_mode: "HTML" },
    );
  }
});

bot.callbackQuery("hotel-confirm", async (ctx) => {
  await ctx.answerCallbackQuery();
  const chatId = ctx.chat?.id;
  const wizard = chatId ? bookHotelWizards.get(chatId) : undefined;

  if (!chatId || !wizard?.prebook || !wizard.guest || !wizard.offer) {
    await ctx.reply("This hotel booking has expired. Please search again with /bookhotel.");
    return;
  }

  await ctx.reply("⏳ Confirming your hotel booking...");

  try {
    const booking = await bookHotel(wizard.prebook.prebookId, wizard.guest);
    bookHotelWizards.delete(chatId);

    await ctx.reply(
      `<b>✅ Hotel booking ${escapeHtml(booking.status.toLowerCase())}</b>\n` +
      `${escapeHtml(booking.hotelName ?? wizard.offer.hotelName)}\n` +
      `${escapeHtml(booking.checkin ?? wizard.offer.checkin)} → ${escapeHtml(booking.checkout ?? wizard.offer.checkout)}\n` +
      `Guest: ${escapeHtml(`${wizard.guest.firstName} ${wizard.guest.lastName}`)}\n` +
      `Booking ID: <code>${escapeHtml(booking.bookingId)}</code>\n` +
      (booking.hotelConfirmationCode
        ? `Hotel confirmation: <code>${escapeHtml(booking.hotelConfirmationCode)}</code>\n`
        : "") +
      (isLiteApiSandbox() ? "\nThis is a LiteAPI sandbox booking. No real reservation or payment was made." : ""),
      { parse_mode: "HTML" },
    );
  } catch (error) {
    console.error("Hotel booking error:", error);
    await ctx.reply(
      `I couldn't complete that hotel booking.\n\n<code>${escapeHtml(hotelErrorDetails(error))}</code>`,
      { parse_mode: "HTML" },
    );
  }
});

bot.callbackQuery("hotel-cancel", async (ctx) => {
  await ctx.answerCallbackQuery();
  if (ctx.chat) bookHotelWizards.delete(ctx.chat.id);
  await ctx.reply("Hotel booking cancelled. Send /bookhotel whenever you want to search again.");
});

bot.command("browse", async (ctx) => {
  const value = (ctx.message?.text ?? "")
    .replace(/^\/browse(?:@\w+)?\s*/i, "")
    .trim();

  if (!value) {
    await ctx.reply("Use this format:\n/browse https://example.com");
    return;
  }

  await ctx.reply("🌐 Opening that public page...");

  try {
    const result = await browsePublicPage(value);
    const pageText = result.text || "The page did not contain readable text.";
    const summary = formatForTelegram(
      await summarizeBrowserPage(result.title, result.url, pageText),
    );
    const heading = result.title ? `<b>${escapeHtml(result.title)}</b>\n` : "";
    const response = `${heading}<a href="${escapeHtml(result.url)}">${escapeHtml(result.url)}</a>\n\n${summary}`;
    const chunks = response.match(/[\s\S]{1,4000}/g) ?? ["The page did not contain readable text."];

    for (const chunk of chunks) {
      await ctx.reply(chunk, {
        parse_mode: "HTML",
        link_preview_options: { is_disabled: true },
      });
    }
  } catch (error) {
    console.error("Browserbase browse error:", error);
    const details = error instanceof Error
      ? error.message.replace(/^Error:\s*/, "").slice(0, 300)
      : "Unknown Browserbase error";
    await ctx.reply(
      `I couldn't browse that page.\n\n<code>${escapeHtml(details)}</code>`,
      { parse_mode: "HTML" },
    );
  }
});

bot.hears(/^\/bookflight(?:@\w+)?(?:\s+.*)?$/i, async (ctx) => {
  bookHotelWizards.delete(ctx.chat.id);
  bookFlightWizards.set(ctx.chat.id, {});

  const commandText = ctx.message?.text ?? "";
  const routeText = commandText.replace(/^\/bookflight(?:@\w+)?\s*/i, "").trim();
  const route = routeText.match(
    /^(.+?)\s+to\s+(.+?)(?=\s+(?:on|at|by|for|with)\b|\s+\d{1,2}(?:st|nd|rd|th)?\s+[a-z]+\b|$)/i,
  );

  if (route?.[1] && route[2]) {
    const [origin, destination] = await Promise.all([
      tryResolveAirport(route[1]),
      tryResolveAirport(route[2]),
    ]);

    if (origin && destination && origin !== destination) {
      await ctx.reply(`✅ Route found: ${origin} → ${destination}`);

      const departureDate = parseDate(routeText);
      const passengersMatch = routeText.match(/\b(\d+)\s+(?:adult|adults|traveler|travelers|passenger|passengers|member|members|people|persons)\b/i);
      const passengers = passengersMatch?.[1] ? Number(passengersMatch[1]) : undefined;

      if (!departureDate) {
        pendingFlights.set(ctx.chat.id, { origin, destination, passengers });
        await showDatePicker(ctx);
      } else if (!passengers) {
        pendingFlights.set(ctx.chat.id, { origin, destination, departureDate });
        await showPassengerPicker(ctx);
      } else {
        await sendFlightOffers(ctx, { origin, destination, departureDate, passengers });
      }
      return;
    }
  }

  await ctx.reply(
    "✈️ Let's book a flight.\n\nWhat is your departure city or airport?\nExample: Dubai or DXB",
  );
});

bot.command("flights", async (ctx) => {
  const input = (ctx.message?.text ?? "")
    .replace(/^\/flights(?:@\w+)?\s*/i, "")
    .trim()
    .split(/\s+/);

  const [origin, destination, departureDate, returnDate] = input;

  if (!origin || !destination || !departureDate) {
    await ctx.reply(
      "Use this format:\n/flights ORIGIN DESTINATION YYYY-MM-DD [RETURN_DATE]\n\n" +
      "Example:\n/flights DEL BOM 2026-12-20 2026-12-27",
    );
    return;
  }

  if (!/^[A-Za-z]{3}$/.test(origin) || !/^[A-Za-z]{3}$/.test(destination)) {
    await ctx.reply("Origin and destination must be 3-letter airport codes, such as DEL or BOM.");
    return;
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(departureDate) ||
      (returnDate && !/^\d{4}-\d{2}-\d{2}$/.test(returnDate))) {
    await ctx.reply("Use dates in YYYY-MM-DD format, for example 2026-12-20.");
    return;
  }

  await sendFlightOffers(ctx, {
    origin,
    destination,
    departureDate,
    returnDate,
  });
});

bot.callbackQuery(/^flight-date:(\d{4}-\d{2}-\d{2})$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const chatId = ctx.chat?.id;
  const date = ctx.match[1];
  const pendingFlight = chatId ? pendingFlights.get(chatId) : undefined;

  if (!chatId || !date || !pendingFlight) {
    await ctx.reply("This flight search has expired. Please send your request again.");
    return;
  }

  pendingFlight.departureDate = date;
  if (!pendingFlight.passengers) {
    await showPassengerPicker(ctx);
    return;
  }

  pendingFlights.delete(chatId);
  bookFlightWizards.delete(chatId);
  await sendFlightOffers(ctx, pendingFlight as FlightSearch);
});

bot.callbackQuery(/^flight-passengers:(\d+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const chatId = ctx.chat?.id;
  const passengerCount = Number(ctx.match[1]);
  const pendingFlight = chatId ? pendingFlights.get(chatId) : undefined;

  if (!chatId || !pendingFlight || !Number.isInteger(passengerCount)) {
    await ctx.reply("This flight search has expired. Please send your request again.");
    return;
  }

  pendingFlight.passengers = passengerCount;
  if (!pendingFlight.departureDate) {
    await showDatePicker(ctx);
    return;
  }

  pendingFlights.delete(chatId);
  bookFlightWizards.delete(chatId);
  await sendFlightOffers(ctx, pendingFlight as FlightSearch);
});

bot.callbackQuery(/^flight:(.+)$/, async (ctx) => {
  const offerId = ctx.match[1];
  const offer = offerId ? flightOffers.get(offerId) : undefined;

  await ctx.answerCallbackQuery();

  if (!offer) {
    await ctx.reply("That flight option has expired. Please run /flights again.");
    return;
  }

  await ctx.reply(
    `<b>Flight selected</b>\n` +
    `${escapeHtml(offer.airline)}\n` +
    `${escapeHtml(formatFlightDateTime(offer.departure))} → ${escapeHtml(formatFlightDateTime(offer.arrival))}\n` +
    `<b>${escapeHtml(offer.totalCurrency)} ${escapeHtml(offer.totalAmount)}</b>\n\n` +
    "This is Duffel test mode. To create the booking, the next step needs passenger names, date of birth, contact details, and payment information.",
    { parse_mode: "HTML" },
  );
});

bot.on("message:text", async (ctx) => {
  const question = ctx.message.text.trim();

  // Messages the Mini App posts through answerWebAppQuery arrive "via" this bot.
  if (question.startsWith("/") || ctx.message.via_bot) return;

  const chatId = ctx.chat.id;
  const hotelWizard = bookHotelWizards.get(chatId);

  if (hotelWizard?.prebook) {
    const guest = parseHotelGuest(question);
    if (!guest) {
      await ctx.reply(
        "Please send the lead guest's first name, last name, and email.\nExample: John Smith john@example.com",
        { reply_markup: new InlineKeyboard().text("Cancel", "hotel-cancel") },
      );
      return;
    }

    hotelWizard.guest = guest;
    await ctx.reply(
      `<b>Confirm hotel booking</b>\n` +
      `${escapeHtml(hotelWizard.offer?.hotelName ?? "Hotel")}\n` +
      `Guest: ${escapeHtml(`${guest.firstName} ${guest.lastName}`)} (${escapeHtml(guest.email)})\n` +
      `<b>${escapeHtml(hotelWizard.prebook.currency)} ${hotelWizard.prebook.price.toFixed(2)}</b>`,
      {
        parse_mode: "HTML",
        reply_markup: new InlineKeyboard()
          .text("✅ Confirm booking", "hotel-confirm")
          .text("Cancel", "hotel-cancel"),
      },
    );
    return;
  }

  if (hotelWizard && !hotelWizard.destination) {
    hotelWizard.destination = question;
    await continueHotelWizard(ctx, hotelWizard);
    return;
  }

  if (hotelWizard && !hotelWizard.checkin) {
    hotelWizard.checkin = parseDate(question);
    await continueHotelWizard(ctx, hotelWizard);
    return;
  }

  if (hotelWizard?.checkin && !hotelWizard.checkout) {
    const checkout = parseDate(question);
    const nights = question.match(/^\s*(\d{1,2})(?:\s+nights?)?\s*$/i)?.[1];

    if (checkout && nightsBetween(hotelWizard.checkin, checkout) >= 1) {
      hotelWizard.checkout = checkout;
    } else if (nights && Number(nights) >= 1) {
      hotelWizard.checkout = addNights(hotelWizard.checkin, Number(nights));
    } else {
      await ctx.reply("Check-out must be after check-in.");
    }

    await continueHotelWizard(ctx, hotelWizard);
    return;
  }

  if (hotelWizard?.checkout && !hotelWizard.adults) {
    const adults = question.match(/^\s*([1-4])(?:\s+(?:adult|adults|guest|guests))?\s*$/i)?.[1];
    if (adults) hotelWizard.adults = Number(adults);
    await continueHotelWizard(ctx, hotelWizard);
    return;
  }

  const isHotelBooking =
    /\b(hotel|hotels|resort|stay|accommodation|room|rooms)\b/i.test(question) &&
    /\b(book|booking|reserve|find|search|need|want|available|cheap|cheapest)\b/i.test(question);

  if (isHotelBooking) {
    const adults = question.match(/\b(\d+)\s+(?:adult|adults|guest|guests|people|persons)\b/i)?.[1];
    const wizard = startHotelWizard(chatId, {
      destination: parseHotelDestination(question),
      checkin: parseDate(question),
      adults: adults ? Number(adults) : undefined,
    });

    await continueHotelWizard(ctx, wizard);
    return;
  }

  const wizard = bookFlightWizards.get(chatId);

  if (wizard) {
    if (!wizard.origin) {
      const origin = await tryResolveAirport(question);
      if (!origin) {
        await ctx.reply("I couldn't find that departure airport. Please try a city name or 3-letter airport code.");
        return;
      }

      wizard.origin = origin;
      await ctx.reply("What is your arrival city or airport?\nExample: Chennai or MAA");
      return;
    }

    if (!wizard.destination) {
      const destination = await tryResolveAirport(question);
      if (!destination) {
        await ctx.reply("I couldn't find that arrival airport. Please try a city name or 3-letter airport code.");
        return;
      }

      if (destination === wizard.origin) {
        await ctx.reply("Departure and arrival airports must be different. Please enter another arrival airport.");
        return;
      }

      wizard.destination = destination;
      pendingFlights.set(chatId, {
        origin: wizard.origin,
        destination,
      });
      await showDatePicker(ctx);
      return;
    }

    const departureDate = parseDate(question);
    if (!wizard.departureDate) {
      if (!departureDate) {
        await showDatePicker(ctx);
        return;
      }

      wizard.departureDate = departureDate;
      pendingFlights.set(chatId, {
        origin: wizard.origin,
        destination: wizard.destination,
        departureDate,
      });
      await showPassengerPicker(ctx);
      return;
    }
  }

  const isFlightBooking = /\b(book|booking|ticket|tickets|flight|flights|fly|travel)\b/i.test(question);
  let route: Pick<FlightSearch, "origin" | "destination"> | undefined;

  if (isFlightBooking) {
    await ctx.reply("⏳ Checking airports and preparing your flight options...");
    try {
      route = await parseNaturalFlightRoute(question);
    } catch (error) {
      console.error("Airport lookup error:", error);
      await ctx.reply("I couldn't check those airports right now. Please try again or use /flights DXB MAA 2026-10-20.");
      return;
    }

    if (!route) {
      await ctx.reply("Please include a route, for example: book a flight from Dubai to Chennai.");
      return;
    }
  }

  if (route && isFlightBooking) {
    const departureDate = parseDate(question);
    const passengersMatch = question.match(/\b(\d+)\s+(?:adult|adults|traveler|travelers|passenger|passengers|member|members|people|persons)\b/i);
    const passengers = passengersMatch ? Number(passengersMatch[1]) : undefined;

    if (!departureDate) {
      pendingFlights.set(chatId, { ...route, passengers });
      await ctx.reply(
        `I can find the cheapest available test-mode flight from ${route.origin} to ${route.destination}.`,
      );
      await showDatePicker(ctx);
      return;
    }

    if (!passengers) {
      pendingFlights.set(chatId, { ...route, departureDate });
      await showPassengerPicker(ctx);
      return;
    }

    await sendFlightOffers(ctx, { ...route, departureDate, passengers });
    return;
  }

  const pendingFlight = pendingFlights.get(chatId);
  if (pendingFlight) {
    if (pendingFlight.departureDate && !pendingFlight.passengers) {
      const manualPassengers = question.match(/^\s*([1-6])(?:\s+(?:passenger|passengers|adult|adults|member|members))?\s*$/i);

      if (manualPassengers?.[1]) {
        pendingFlight.passengers = Number(manualPassengers[1]);
        pendingFlights.delete(chatId);
        bookFlightWizards.delete(chatId);
        await sendFlightOffers(ctx, pendingFlight as FlightSearch);
        return;
      }

      await showPassengerPicker(ctx);
      return;
    }

    const departureDate = parseDate(question);
    if (departureDate) {
      const passengersMatch = question.match(/\b(\d+)\s+(?:adult|adults|traveler|travelers|passenger|passengers|member|members|people|persons)\b/i);
      const passengers = passengersMatch ? Number(passengersMatch[1]) : undefined;

      if (!passengers) {
        pendingFlights.set(chatId, { ...pendingFlight, departureDate });
        await showPassengerPicker(ctx);
        return;
      }

      pendingFlights.delete(chatId);
      bookFlightWizards.delete(chatId);
      await sendFlightOffers(ctx, { ...pendingFlight, departureDate, passengers });
      return;
    }

    await showDatePicker(ctx);
    return;
  }

  await ctx.reply("🔎 Searching the web and preparing your answer...");

  try {
    const results = await searchWeb(question);
    const answer = formatForTelegram(await generateAnswer(question, results));

    // Telegram text messages have a length limit.
    const chunks = answer.match(/[\s\S]{1,4000}/g) ?? [
      "I couldn't generate an answer."
    ];

    for (const chunk of chunks) {
      await ctx.reply(chunk, {
        parse_mode: "HTML",
        link_preview_options: {
          is_disabled: true,
        },
      });
    }
  } catch (error) {
    console.error("Bot error:", error);

    await ctx.reply(
      "Sorry, I couldn't process your question right now. " +
      "Please try again in a moment."
    );
  }
});

bot.catch((error) => {
  console.error("Telegram handler error:", error);
});

const miniAppServer = startMiniAppServer(bot, token, webAppPort);
console.log(`Mini App server listening on http://localhost:${miniAppServer.port}`);

if (webAppUrl) {
  // The chat menu button opens the Mini App in every private chat with the bot.
  bot.api.setChatMenuButton({
    menu_button: { type: "web_app", text: "Travel app", web_app: { url: webAppUrl } },
  }).catch((error) => console.error("Could not set the Mini App menu button:", error));
} else {
  console.warn("WEBAPP_URL is not set, so the Mini App menu button and /app are disabled.");
}

bot.start();

console.log("Telegram AI bot is running...");
