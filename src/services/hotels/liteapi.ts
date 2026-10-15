
const searchBaseUrl = "https://api.liteapi.travel/v3.0";
const bookingBaseUrl = "https://book.liteapi.travel/v3.0";

export type HotelSearch = {
  destination: string;
  checkin: string;
  checkout: string;
  adults: number;
};

export type HotelOffer = {
  offerId: string;
  hotelId: string;
  hotelName: string;
  address?: string;
  stars?: number;
  rating?: number;
  reviewCount?: number;
  roomName: string;
  boardName?: string;
  refundable: boolean;
  totalAmount: number;
  totalCurrency: string;
  checkin: string;
  checkout: string;
  adults: number;
};

export type HotelPrebook = {
  prebookId: string;
  price: number;
  currency: string;
  priceChanged: boolean;
  cancellationChanged: boolean;
};

export type HotelGuest = {
  firstName: string;
  lastName: string;
  email: string;
};

export type HotelBooking = {
  bookingId: string;
  status: string;
  hotelConfirmationCode?: string;
  hotelName?: string;
  checkin?: string;
  checkout?: string;
  totalAmount?: number;
  totalCurrency?: string;
};

function getKey(): string {
  const key = process.env.LITEAPI_KEY;

  if (!key) {
    throw new Error("LITEAPI_KEY is missing");
  }

  return key;
}

export function isLiteApiSandbox(): boolean {
  return getKey().startsWith("sand_");
}

async function liteApiRequest<T>(
  url: string,
  options: {
    method?: "GET" | "POST";
    body?: unknown;
  } = {},
): Promise<T> {
  const response = await fetch(url, {
    method: options.method ?? "GET",
    headers: {
      "X-API-Key": getKey(),
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: options.body
      ? JSON.stringify(options.body)
      : undefined,
    signal: AbortSignal.timeout(30000),
  });

  if (!response.ok) {
    const errorBody = await response.text();

    throw new Error(
      `LiteAPI returned ${response.status}: ${errorBody.slice(0, 500)}`,
    );
  }

  return response.json() as Promise<T>;
}

type Amount = { amount?: number; currency?: string };

export async function searchHotels(
  search: HotelSearch,
): Promise<HotelOffer[]> {
  const response = await liteApiRequest<{
    data?: Array<{
      hotelId: string;
      roomTypes?: Array<{
        offerId: string;
        offerRetailRate?: Amount;
        rates?: Array<{
          name?: string;
          boardName?: string;
          retailRate?: { total?: Amount[] };
          cancellationPolicies?: { refundableTag?: string };
        }>;
      }>;
    }>;
    hotels?: Array<{
      id: string;
      name?: string;
      address?: string;
      stars?: number;
      rating?: number;
      review_count?: number;
    }>;
  }>(`${searchBaseUrl}/hotels/rates`, {
    method: "POST",
    body: {
      aiSearch: `hotels in ${search.destination}`,
      checkin: search.checkin,
      checkout: search.checkout,
      occupancies: [{ adults: search.adults }],
      currency: process.env.LITEAPI_CURRENCY || "USD",
      guestNationality: process.env.LITEAPI_GUEST_NATIONALITY || "AE",
      limit: 20,
      maxRatesPerHotel: 1,
      timeout: 10,
      includeHotelData: true,
    },
  });

  const hotels = new Map(
    (response.hotels ?? []).map((hotel) => [hotel.id, hotel]),
  );

  return (response.data ?? [])
    .flatMap((hotelRates) => {
      const roomType = hotelRates.roomTypes?.[0];
      const rate = roomType?.rates?.[0];
      const total = roomType?.offerRetailRate ?? rate?.retailRate?.total?.[0];
      const hotel = hotels.get(hotelRates.hotelId);
      // Skip rates without hotel details; users can't judge an unnamed hotel.
      if (!roomType || total?.amount === undefined || !hotel?.name) return [];

      return [{
        offerId: roomType.offerId,
        hotelId: hotelRates.hotelId,
        hotelName: hotel.name,
        address: hotel.address,
        stars: hotel.stars,
        rating: hotel.rating || undefined,
        reviewCount: hotel.review_count,
        roomName: rate?.name ?? "Room",
        boardName: rate?.boardName,
        refundable: rate?.cancellationPolicies?.refundableTag === "RFN",
        totalAmount: total.amount,
        totalCurrency: total.currency ?? "",
        checkin: search.checkin,
        checkout: search.checkout,
        adults: search.adults,
      }];
    })
    .sort((first, second) => first.totalAmount - second.totalAmount)
    .slice(0, 8);
}

export async function prebookHotel(offerId: string): Promise<HotelPrebook> {
  const response = await liteApiRequest<{
    data?: {
      prebookId?: string;
      price?: number;
      currency?: string;
      priceDifferencePercent?: number;
      cancellationChanged?: boolean;
    };
  }>(`${bookingBaseUrl}/rates/prebook`, {
    method: "POST",
    body: { offerId, usePaymentSdk: false },
  });

  const prebook = response.data;
  if (!prebook?.prebookId || prebook.price === undefined) {
    throw new Error("LiteAPI did not return a prebook ID");
  }

  return {
    prebookId: prebook.prebookId,
    price: prebook.price,
    currency: prebook.currency ?? "",
    priceChanged: (prebook.priceDifferencePercent ?? 0) !== 0,
    cancellationChanged: prebook.cancellationChanged ?? false,
  };
}

export async function bookHotel(
  prebookId: string,
  guest: HotelGuest,
): Promise<HotelBooking> {
  // ACC_CREDIT_CARD charges the LiteAPI account card on a live key,
  // so bookings stay limited to sandbox keys until a payment flow exists.
  if (!isLiteApiSandbox()) {
    throw new Error("Hotel booking is only enabled with a LiteAPI sandbox key");
  }

  const response = await liteApiRequest<{
    data?: {
      bookingId?: string;
      status?: string;
      hotelConfirmationCode?: string;
      checkin?: string;
      checkout?: string;
      hotel?: { name?: string };
      price?: number;
      currency?: string;
    };
  }>(`${bookingBaseUrl}/rates/book`, {
    method: "POST",
    body: {
      prebookId,
      clientReference: `propzingbot-${Date.now()}`,
      holder: guest,
      payment: { method: "ACC_CREDIT_CARD" },
      guests: [{ occupancyNumber: 1, ...guest }],
    },
  });

  const booking = response.data;
  if (!booking?.bookingId) {
    throw new Error("LiteAPI did not return a booking ID");
  }

  return {
    bookingId: booking.bookingId,
    status: booking.status ?? "UNKNOWN",
    hotelConfirmationCode: booking.hotelConfirmationCode,
    hotelName: booking.hotel?.name,
    checkin: booking.checkin,
    checkout: booking.checkout,
    totalAmount: booking.price,
    totalCurrency: booking.currency,
  };
}
