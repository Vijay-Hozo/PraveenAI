
import "dotenv/config";
import { Bot } from "grammy";
import { searchWeb } from "./services/brave";
import { generateAnswer } from "./services/gemini";

const token = process.env.TELEGRAM_BOT_TOKEN;

if (!token) {
  throw new Error("TELEGRAM_BOT_TOKEN is missing");
}

const bot = new Bot(token);

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
    "I'll use Brave Search and Gemini to answer it."
  );
});

bot.on("message:text", async (ctx) => {
  const question = ctx.message.text.trim();

  if (question.startsWith("/")) return;

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
