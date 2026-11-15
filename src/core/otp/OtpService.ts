// One-time login codes, kept in Redis so they expire on their own (RULES.md #12, #13).
//
// Rules:
//   - 6 digits from a cryptographic random source
//   - stored only as an HMAC, valid for 5 minutes
//   - works once; 5 wrong guesses destroy it
//   - one request per phone per minute, at most 5 per hour
import { createHmac, randomInt, timingSafeEqual } from "node:crypto";
import type { Redis } from "../../config/redis.js";
import { ApiError } from "../../utils/ApiError.js";

const CODE_TTL_SECONDS = 5 * 60;
const MAX_VERIFY_ATTEMPTS = 5;
const RESEND_COOLDOWN_SECONDS = 60;
const MAX_REQUESTS_PER_HOUR = 5;

const keys = (phone: string) => ({
  code: `otp:code:${phone}`,
  attempts: `otp:attempts:${phone}`,
  cooldown: `otp:cooldown:${phone}`,
  hourly: `otp:hourly:${phone}`,
});

export class OtpService {
  constructor(
    private readonly redis: Redis,
    private readonly hmacSecret: string
  ) {}

  /** Creates a new code for this phone and returns it so it can be sent. */
  async issue(phone: string): Promise<string> {
    const key = keys(phone);

    // SET NX: only the first request inside the cooldown window gets through.
    const allowed = await this.redis.set(
      key.cooldown,
      "1",
      "EX",
      RESEND_COOLDOWN_SECONDS,
      "NX"
    );
    if (allowed !== "OK") {
      throw ApiError.tooManyRequests(
        "Please wait a minute before requesting another code"
      );
    }

    const requestsThisHour = await this.redis.incr(key.hourly);
    if (requestsThisHour === 1) {
      await this.redis.expire(key.hourly, 60 * 60);
    }
    if (requestsThisHour > MAX_REQUESTS_PER_HOUR) {
      throw ApiError.tooManyRequests(
        "Too many codes requested, try again later"
      );
    }

    const code = randomInt(0, 1_000_000).toString().padStart(6, "0");
    await this.redis
      .multi()
      .set(key.code, this.hash(phone, code), "EX", CODE_TTL_SECONDS)
      .del(key.attempts)
      .exec();
    return code;
  }

  /** True only for the right, unexpired, unused code. A correct code is consumed. */
  async verify(phone: string, code: string): Promise<boolean> {
    const key = keys(phone);

    const attempts = await this.redis.incr(key.attempts);
    if (attempts === 1) {
      await this.redis.expire(key.attempts, CODE_TTL_SECONDS);
    }
    if (attempts > MAX_VERIFY_ATTEMPTS) {
      await this.redis.del(key.code); // too many guesses: the code is dead
      return false;
    }

    const stored = await this.redis.get(key.code);
    if (!stored) return false;

    const expected = Buffer.from(stored);
    const actual = Buffer.from(this.hash(phone, code));
    const matches =
      expected.length === actual.length && timingSafeEqual(expected, actual);
    if (!matches) return false;

    // Single use: when two requests verify at once, only the one that deletes the key wins.
    const deleted = await this.redis.del(key.code);
    await this.redis.del(key.attempts);
    return deleted === 1;
  }

  private hash(phone: string, code: string): string {
    return createHmac("sha256", this.hmacSecret)
      .update(`${phone}:${code}`)
      .digest("hex");
  }
}
