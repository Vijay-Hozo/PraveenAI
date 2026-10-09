
const BRAVE_API_URL =
  "https://api.search.brave.com/res/v1/web/search";

export type SearchResult = {
  title: string;
  url: string;
  description: string;
};

export async function searchWeb(
  query: string,
): Promise<SearchResult[]> {
  const apiKey = process.env.BRAVE_API_KEY;

  if (!apiKey) {
    throw new Error("BRAVE_API_KEY is missing");
  }

  const params = new URLSearchParams({
    q: query.slice(0, 600),
    count: "5",
    country: "IN",
    search_lang: "en",
    safesearch: "moderate",
  });

  const response = await fetch(
    `${BRAVE_API_URL}?${params.toString()}`,
    {
      headers: {
        Accept: "application/json",
        "X-Subscription-Token": apiKey,
      },
      signal: AbortSignal.timeout(15000),
    },
  );

  if (!response.ok) {
    throw new Error(
      `Brave Search failed: HTTP ${response.status}`,
    );
  }

  const data = await response.json() as {
    web?: {
      results?: Array<{
        title?: string;
        url?: string;
        description?: string;
      }>;
    };
  };

  return (data.web?.results ?? [])
    .filter((item) => item.title && item.url)
    .slice(0, 5)
    .map((item) => ({
      title: item.title!,
      url: item.url!,
      description: item.description ?? "",
    }));
}
