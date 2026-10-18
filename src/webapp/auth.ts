import { createHmac, timingSafeEqual } from "node:crypto";

export type WebAppUser = {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  language_code?: string;
};

export type WebAppInitData = {
  user: WebAppUser;
  queryId?: string;
  startParam?: string;
  chatType?: string;
  authDate: number;
};

/**
 * Validates Telegram Mini App initData as described in
 * https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
 */
export function validateInitData(
  initData: string,
  botToken: string,
  maxAgeSeconds = 24 * 60 * 60,
): WebAppInitData | undefined {
  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if (!hash) return undefined;

  params.delete("hash");
  const dataCheckString = [...params.entries()]
    .map(([key, value]) => `${key}=${value}`)
    .sort()
    .join("\n");

  const secretKey = createHmac("sha256", "WebAppData").update(botToken).digest();
  const expectedHash = createHmac("sha256", secretKey).update(dataCheckString).digest();
  const receivedHash = Buffer.from(hash, "hex");

  if (receivedHash.length !== expectedHash.length || !timingSafeEqual(receivedHash, expectedHash)) {
    return undefined;
  }

  const authDate = Number(params.get("auth_date"));
  if (!authDate || Date.now() / 1000 - authDate > maxAgeSeconds) return undefined;

  const userJson = params.get("user");
  if (!userJson) return undefined;

  try {
    const user = JSON.parse(userJson) as WebAppUser;
    if (!user.id) return undefined;

    return {
      user,
      queryId: params.get("query_id") ?? undefined,
      startParam: params.get("start_param") ?? undefined,
      chatType: params.get("chat_type") ?? undefined,
      authDate,
    };
  } catch {
    return undefined;
  }
}
