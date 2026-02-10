import { verify } from "https://deno.land/x/djwt@v3.0.1/mod.ts";

export interface TokenPayload {
  sub: string;
  role?: string;
  aud?: string;
  serial_number: string;
  token_type: string;
  exp: number;
  iat?: number;
  device_uuid: string; // UUID from devices.id - primary device identifier
  user_uuid?: string | null; // Optional UUID from auth.users.id, can be null if not assigned
}

function sanitizeJwk(jwk: JsonWebKey): JsonWebKey {
  const sanitized = { ...jwk } as JsonWebKey;
  // deno-lint-ignore no-explicit-any
  delete (sanitized as any).key_ops;
  // deno-lint-ignore no-explicit-any
  delete (sanitized as any).use;
  return sanitized;
}

async function importVerifyKey(): Promise<{ key: CryptoKey } | null> {
  const jwkStr =
    Deno.env.get("DEVICE_JWT_PUBLIC_KEY_JWK") ??
    Deno.env.get("DEVICE_JWT_PRIVATE_KEY_JWK");
  if (!jwkStr) {
    return null;
  }

  let jwk: JsonWebKey;
  try {
    jwk = JSON.parse(jwkStr);
  } catch {
    throw new Error("DEVICE_JWT_PUBLIC_KEY_JWK is not valid JSON");
  }

  const alg = Deno.env.get("DEVICE_JWT_ALG") ?? jwk.alg ?? (jwk.kty === "EC" ? "ES256" : "RS256");
  const sanitized = sanitizeJwk(jwk);

  if (alg === "ES256") {
    if (sanitized.kty !== "EC" || sanitized.crv !== "P-256") {
      throw new Error("DEVICE_JWT_PUBLIC_KEY_JWK must be EC P-256 for ES256");
    }
    const key = await crypto.subtle.importKey(
      "jwk",
      sanitized,
      { name: "ECDSA", namedCurve: "P-256" },
      false,
      ["verify"],
    );
    return { key };
  }

  if (alg === "RS256") {
    const key = await crypto.subtle.importKey(
      "jwk",
      sanitized,
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["verify"],
    );
    return { key };
  }

  throw new Error(`Unsupported DEVICE_JWT_ALG: ${alg}`);
}

export async function verifyDeviceToken(
  token: string,
  tokenSecret?: string,
): Promise<TokenPayload> {
  const jwkKey = await importVerifyKey();
  if (jwkKey) {
    return (await verify(token, jwkKey.key)) as unknown as TokenPayload;
  }

  if (!tokenSecret) {
    throw new Error("SUPABASE_JWT_SECRET/DEVICE_JWT_SECRET not configured");
  }

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(tokenSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );

  return (await verify(token, key)) as unknown as TokenPayload;
}
