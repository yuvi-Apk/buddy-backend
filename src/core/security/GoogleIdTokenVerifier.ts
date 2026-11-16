// Checks a Google ID token from "Sign in with Google" and returns who signed in.
//
// The token is a JWT signed by Google (RS256). Checked: signature against Google's public
// keys, issuer, audience (one of our client IDs), expiry, and a verified email.
// Google's keys are cached in Redis so every API instance shares them (core-rules #20).
import { createPublicKey, type JsonWebKey, type KeyObject } from "node:crypto";
import jwt from "jsonwebtoken";
import { z } from "zod";
import type { Redis } from "../../config/redis.js";
import { ApiError } from "../../utils/ApiError.js";

export interface GoogleIdentity {
  googleAccountId: string;
  email: string; // lowercase
  name: string;
  avatarUrl: string | null;
}

export interface GoogleTokenVerifier {
  verify(idToken: string): Promise<GoogleIdentity>;
}

// Fetches Google's public keys. Swapped out in tests.
export type FetchGoogleKeys = () => Promise<{
  keys: JsonWebKey[];
  maxAgeSeconds: number;
}>;

const GOOGLE_KEYS_URL = "https://www.googleapis.com/oauth2/v3/certs";
const GOOGLE_ISSUERS: [string, string] = [
  "accounts.google.com",
  "https://accounts.google.com",
];
const KEYS_CACHE_KEY = "google:jwks";
const KEYS_REFETCH_LOCK_KEY = "google:jwks:refetch-lock";
const DEFAULT_KEYS_MAX_AGE_SECONDS = 60 * 60;
// An unknown key id refetches at most once a minute, so forged tokens can't flood Google.
const REFETCH_LOCK_SECONDS = 60;

const headerSchema = z.object({ alg: z.literal("RS256"), kid: z.string() });
const claimsSchema = z.object({
  sub: z.string().min(1),
  email: z.email(),
  email_verified: z.literal(true),
  name: z.string().optional(),
  picture: z.url().optional(),
});
const keySchema = z.looseObject({ kid: z.string(), kty: z.literal("RSA") });
type GoogleKey = z.infer<typeof keySchema>;

export const fetchGoogleKeys: FetchGoogleKeys = async () => {
  const response = await fetch(GOOGLE_KEYS_URL, {
    signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) throw new Error(`Google keys: HTTP ${response.status}`);
  const body = (await response.json()) as { keys?: JsonWebKey[] };
  const maxAge = /max-age=(\d+)/.exec(
    response.headers.get("cache-control") ?? ""
  )?.[1];
  return {
    keys: body.keys ?? [],
    maxAgeSeconds: maxAge ? Number(maxAge) : DEFAULT_KEYS_MAX_AGE_SECONDS,
  };
};

export class GoogleIdTokenVerifier implements GoogleTokenVerifier {
  constructor(
    private readonly redis: Redis,
    private readonly clientIds: [string, ...string[]],
    private readonly fetchKeys: FetchGoogleKeys = fetchGoogleKeys
  ) {}

  async verify(idToken: string): Promise<GoogleIdentity> {
    // core-rules #14: one message for every failure.
    const invalid = ApiError.unauthorized("Google sign-in failed");

    const header = headerSchema.safeParse(
      jwt.decode(idToken, { complete: true })?.header
    );
    if (!header.success) throw invalid;

    const publicKey = await this.findPublicKey(header.data.kid);
    if (!publicKey) throw invalid;

    let decoded: unknown;
    try {
      decoded = jwt.verify(idToken, publicKey, {
        algorithms: ["RS256"],
        issuer: GOOGLE_ISSUERS,
        audience: this.clientIds,
      });
    } catch {
      throw invalid;
    }

    const claims = claimsSchema.safeParse(decoded);
    if (!claims.success) throw invalid;

    const email = claims.data.email.toLowerCase();
    return {
      googleAccountId: claims.data.sub,
      email,
      name: claims.data.name?.trim() || email.split("@")[0]!,
      avatarUrl: claims.data.picture ?? null,
    };
  }

  private async findPublicKey(kid: string): Promise<KeyObject | null> {
    let keys = await this.readCachedKeys();
    if (!keys?.some((key) => key.kid === kid) && (await this.mayRefetch())) {
      keys = await this.refreshKeys();
    }
    const key = keys?.find((candidate) => candidate.kid === kid);
    return key ? createPublicKey({ key, format: "jwk" }) : null;
  }

  private async refreshKeys(): Promise<GoogleKey[] | null> {
    try {
      const { keys, maxAgeSeconds } = await this.fetchKeys();
      const parsed = keys.flatMap((key) => {
        const result = keySchema.safeParse(key);
        return result.success ? [result.data] : [];
      });
      await this.redis
        .set(KEYS_CACHE_KEY, JSON.stringify(parsed), "EX", maxAgeSeconds)
        .catch(() => undefined);
      return parsed;
    } catch {
      return null; // Google unreachable: the sign-in fails with the usual message.
    }
  }

  private async readCachedKeys(): Promise<GoogleKey[] | null> {
    try {
      const raw = await this.redis.get(KEYS_CACHE_KEY);
      const parsed = z.array(keySchema).safeParse(raw ? JSON.parse(raw) : null);
      return parsed.success ? parsed.data : null;
    } catch {
      return null;
    }
  }

  private async mayRefetch(): Promise<boolean> {
    try {
      const acquired = await this.redis.set(
        KEYS_REFETCH_LOCK_KEY,
        "1",
        "EX",
        REFETCH_LOCK_SECONDS,
        "NX"
      );
      return acquired === "OK";
    } catch {
      return true; // Redis down: no shared cache, so fetch.
    }
  }
}
