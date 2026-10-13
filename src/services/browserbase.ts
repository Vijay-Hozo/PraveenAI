import Browserbase from "@browserbasehq/sdk";

const maxTextLength = 6000;

function getClient(): Browserbase {
  const apiKey = process.env.BROWSERBASE_API_KEY;
  if (!apiKey) {
    throw new Error("BROWSERBASE_API_KEY is missing");
  }

  return new Browserbase({ apiKey });
}

function isPublicHostname(hostname: string): boolean {
  const normalizedHostname = hostname.toLowerCase();

  if (
    normalizedHostname === "localhost" ||
    normalizedHostname.endsWith(".localhost") ||
    normalizedHostname === "metadata.google.internal" ||
    normalizedHostname.endsWith(".internal")
  ) {
    return false;
  }

  const ipv4Parts = normalizedHostname.split(".");
  if (
    ipv4Parts.length === 4 &&
    ipv4Parts.every((part) => /^\d+$/.test(part) && Number(part) <= 255)
  ) {
    const first = Number(ipv4Parts[0]);
    const second = Number(ipv4Parts[1]);
    return first !== 10 &&
      first !== 127 &&
      !(first === 169 && second === 254) &&
      !(first === 172 && second >= 16 && second <= 31) &&
      !(first === 192 && second === 168);
  }

  return !normalizedHostname.includes(":");
}

function parsePublicUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Please provide a valid URL.");
  }

  if (url.protocol !== "https:") {
    throw new Error("Only HTTPS URLs can be browsed.");
  }

  if (url.username || url.password || !isPublicHostname(url.hostname)) {
    throw new Error("That URL is not allowed.");
  }

  return url;
}

export type BrowserPage = {
  url: string;
  title: string;
  text: string;
  sessionId: string;
};

type BrowserWorkerResult = Omit<BrowserPage, "sessionId">;

async function runBrowserWorker(
  connectUrl: string,
  targetUrl: string,
): Promise<BrowserWorkerResult> {
  const worker = Bun.spawn(
    ["node", "src/services/browserbase-worker.mjs"],
    {
      cwd: process.cwd(),
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    },
  );

  worker.stdin.write(JSON.stringify({ connectUrl, targetUrl }));
  worker.stdin.end();

  const [exitCode, output, errorOutput] = await Promise.all([
    worker.exited,
    new Response(worker.stdout).text(),
    new Response(worker.stderr).text(),
  ]);

  if (exitCode !== 0) {
    throw new Error(errorOutput.trim() || "Browser worker failed.");
  }

  try {
    return JSON.parse(output) as BrowserWorkerResult;
  } catch {
    throw new Error("Browser worker returned an invalid response.");
  }
}

export async function browsePublicPage(value: string): Promise<BrowserPage> {
  const url = parsePublicUrl(value);
  const browserbase = getClient();
  const session = await browserbase.sessions.create({
    api_timeout: 60,
    browserSettings: {
      allowedDomains: [url.hostname],
      blockAds: true,
      recordSession: false,
      logSession: false,
    },
  });

  const result = await runBrowserWorker(session.connectUrl, url.toString());

  return {
    url: result.url,
    title: result.title,
    text: result.text.slice(0, maxTextLength),
    sessionId: session.id,
  };
}
