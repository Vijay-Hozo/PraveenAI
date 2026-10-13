import { chromium } from "playwright-core";

const input = await new Response(process.stdin).text();
const { connectUrl, targetUrl } = JSON.parse(input);
let browser;

try {
  browser = await chromium.connectOverCDP(connectUrl, { timeout: 45000 });
  const context = browser.contexts()[0];
  if (!context) {
    throw new Error("Browserbase did not provide a browser context.");
  }

  const page = context.pages()[0] ?? await context.newPage();
  await page.goto(targetUrl, {
    waitUntil: "domcontentloaded",
    timeout: 20000,
  });

  console.log(JSON.stringify({
    url: page.url(),
    title: await page.title(),
    text: (await page.locator("body").innerText({ timeout: 20000 })).trim(),
  }));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
} finally {
  await browser?.close();
}
