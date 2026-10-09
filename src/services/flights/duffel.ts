
const baseUrl = "https://api.duffel.com";

export type FlightSearch = {
  origin: string;
  destination: string;
  departureDate: string;
  returnDate?: string;
  passengers?: number;
};

export type FlightOffer = {
  id: string;
  totalAmount: string;
  totalCurrency: string;
  airline: string;
  departure: string;
  arrival: string;
  duration?: string;
  stops: number;
};

type DuffelAirport = {
  iata_code?: string;
  name?: string;
  city_name?: string;
  iata_city_code?: string;
};

function getToken(): string {
  const token = process.env.DUFFEL_ACCESS_TOKEN;

  if (!token) {
    throw new Error("DUFFEL_ACCESS_TOKEN is missing");
  }

  return token;
}

export async function duffelRequest<T>(
  path: string,
  options: {
    method?: "GET" | "POST";
    body?: unknown;
  } = {},
): Promise<T> {
  const response = await fetch(`${baseUrl}${path}`, {
    method: options.method ?? "GET",
    headers: {
      Authorization: `Bearer ${getToken()}`,
      "Duffel-Version": "v2",
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: options.body
      ? JSON.stringify(options.body)
      : undefined,
    signal: AbortSignal.timeout(20000),
  });

  if (!response.ok) {
    const errorBody = await response.text();

    throw new Error(
      `Duffel API returned ${response.status}: ${errorBody.slice(0, 500)}`,
    );
  }

  return response.json() as Promise<T>;
}

export async function searchFlights(
  search: FlightSearch,
): Promise<FlightOffer[]> {
  const slices = [
    {
      origin: search.origin.toUpperCase(),
      destination: search.destination.toUpperCase(),
      departure_date: search.departureDate,
    },
  ];

  if (search.returnDate) {
    slices.push({
      origin: search.destination.toUpperCase(),
      destination: search.origin.toUpperCase(),
      departure_date: search.returnDate,
    });
  }

  const response = await duffelRequest<{
    data?: {
      offers?: Array<{
        id: string;
        total_amount?: string;
        total_currency?: string;
        owner?: { name?: string };
        slices?: Array<{
          duration?: string;
          segments?: Array<{
            departing_at?: string;
            arriving_at?: string;
            origin?: { iata_code?: string };
            destination?: { iata_code?: string };
          }>;
        }>;
      }>;
    };
  }>("/air/offer_requests", {
    method: "POST",
    body: {
      data: {
        slices,
        passengers: Array.from(
          { length: search.passengers ?? 1 },
          () => ({ type: "adult" }),
        ),
        cabin_class: "economy",
        return_offers: true,
      },
    },
  });

  return (response.data?.offers ?? [])
    .sort((first, second) =>
      Number(first.total_amount ?? Number.POSITIVE_INFINITY) -
      Number(second.total_amount ?? Number.POSITIVE_INFINITY),
    )
    .slice(0, 8)
    .map((offer) => {
      const firstSlice = offer.slices?.[0];
      const firstSegment = firstSlice?.segments?.[0];
      const lastSegment = firstSlice?.segments?.at(-1);

      return {
        id: offer.id,
        totalAmount: offer.total_amount ?? "-",
        totalCurrency: offer.total_currency ?? "",
        airline: offer.owner?.name ?? "Unknown airline",
        departure: `${firstSegment?.origin?.iata_code ?? "?"} ${firstSegment?.departing_at ?? ""}`.trim(),
        arrival: `${lastSegment?.destination?.iata_code ?? "?"} ${lastSegment?.arriving_at ?? ""}`.trim(),
        duration: firstSlice?.duration,
        stops: Math.max((firstSlice?.segments?.length ?? 1) - 1, 0),
      };
    });
}

type AirportPage = {
  data?: DuffelAirport[];
  meta?: { after?: string };
};

let airportDirectoryPromise: Promise<DuffelAirport[]> | undefined;

async function loadAirportDirectory(): Promise<DuffelAirport[]> {
  const airports: DuffelAirport[] = [];
  let after: string | undefined;

  do {
    const query = new URLSearchParams({ limit: "200" });
    if (after) query.set("after", after);

    const page = await duffelRequest<AirportPage>(
      `/air/airports?${query.toString()}`,
    );
    airports.push(...(page.data ?? []));
    after = page.meta?.after;
  } while (after);

  return airports;
}

export async function resolveAirportCode(
  location: string,
): Promise<string | undefined> {
  airportDirectoryPromise ??= loadAirportDirectory();
  const airports = await airportDirectoryPromise;
  const normalizedLocation = location.trim().toLowerCase();

  const exactMatch = airports.find((airport) =>
    airport.iata_code?.toLowerCase() === normalizedLocation ||
    airport.iata_city_code?.toLowerCase() === normalizedLocation ||
    airport.city_name?.toLowerCase() === normalizedLocation ||
    airport.name?.toLowerCase() === normalizedLocation,
  );

  return exactMatch?.iata_code;
}
