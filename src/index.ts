
import "dotenv/config";
import { Bot } from "grammy";
import { InlineKeyboard } from "grammy";
import type { Context } from "grammy";
import { searchWeb } from "./services/brave";
import { generateAnswer } from "./services/gemini";
import {
  searchFlights,
  resolveAirportCode,
  type FlightOffer,
  type FlightSearch,
} from "./services/flights/duffel";

const token = process.env.TELEGRAM_BOT_TOKEN;

if (!token) {
  throw new Error("TELEGRAM_BOT_TOKEN is missing");
}

const bot = new Bot(token);
const flightOffers = new Map<string, FlightOffer>();
type PendingFlight = Pick<FlightSearch, "origin" | "destination"> & {
  departureDate?: string;
  passengers?: number;
};

const pendingFlights = new Map<
  number,
  PendingFlight
>();

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

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

function formatFlightDateTime(value: string): string {
  const match = value.match(
    /^(?:(\w{3})\s+)?(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/,
  );
  if (!match) return value;

  const [, airportCode, year, monthNumber, day, hourNumber, minute] = match;
  const monthNames = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
  ];
  const month = monthNames[Number(monthNumber) - 1] ?? monthNumber;
  const hour = Number(hourNumber);
  const meridiem = hour >= 12 ? "PM" : "AM";
  const displayHour = hour % 12 || 12;

  return `${airportCode ? `${airportCode} ` : ""}${day} ${month} ${year} at ${displayHour}:${minute} ${meridiem}`;
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

function datePickerKeyboard(): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  const today = new Date();

  for (let offset = 1; offset <= 30; offset += 1) {
    const date = new Date(today);
    date.setDate(today.getDate() + offset);
    keyboard.text(dateLabel(date), `flight-date:${dateAsIso(date)}`);

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

async function parseNaturalFlightRoute(
  question: string,
): Promise<Pick<FlightSearch, "origin" | "destination"> | undefined> {
  const routeEnd = "(?=\\s+(?:at|on|for|with|cheapest|cheaper|lowest|flight|flights|ticket|tickets)\\b|$)";
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
    resolveAirportCode(originName),
    resolveAirportCode(destinationName),
  ]);

  return origin && destination ? { origin, destination } : undefined;
}

function parseDate(value: string): string | undefined {
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

bot.command("start", async (ctx) => {
  await ctx.reply(
    "Hello! I'm your AI web search assistant.\n\n" +
    "Send me a question and I'll search the web " +
    "and generate an answer."
  );
});

bot.command("help", async (ctx) => {
  await ctx.reply(
    "Ask me any question.\n" +
    "I'll use Brave Search and Gemini to answer it.\n\n" +
    "For flights, use:\n" +
    "/flights DEL BOM 2026-12-20"
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

  if (question.startsWith("/")) return;

  const chatId = ctx.chat.id;
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
    const passengersMatch = question.match(/\b(\d+)\s+(?:adult|adults|traveler|travelers|passenger|passengers|member|members)\b/i);
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
        await sendFlightOffers(ctx, pendingFlight as FlightSearch);
        return;
      }

      await showPassengerPicker(ctx);
      return;
    }

    const departureDate = parseDate(question);
    if (departureDate) {
      const passengersMatch = question.match(/\b(\d+)\s+(?:adult|adults|traveler|travelers|passenger|passengers|member|members)\b/i);
      const passengers = passengersMatch ? Number(passengersMatch[1]) : undefined;

      if (!passengers) {
        pendingFlights.set(chatId, { ...pendingFlight, departureDate });
        await showPassengerPicker(ctx);
        return;
      }

      pendingFlights.delete(chatId);
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

bot.start();

console.log("Telegram AI bot is running...");
