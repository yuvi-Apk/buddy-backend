// Password hashing with scrypt from Node's built-in crypto (RULES.md #12). No extra package.
// Stored format: scrypt$N$r$p$<salt base64>$<hash base64>
// The cost values are saved inside each hash, so they can be raised later without breaking old ones.
import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";

// OWASP-recommended scrypt settings: N=2^15, r=8, p=3.
const COST = { N: 2 ** 15, r: 8, p: 3 } as const;
const KEY_LENGTH = 64;
const SALT_LENGTH = 16;
const MAX_MEMORY = 128 * 1024 * 1024;

function derive(
  password: string,
  salt: Buffer,
  cost: { N: number; r: number; p: number },
  keyLength: number
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(
      password,
      salt,
      keyLength,
      { ...cost, maxmem: MAX_MEMORY },
      (err, key) => (err ? reject(err) : resolve(key))
    );
  });
}

export class PasswordHasher {
  async hash(password: string): Promise<string> {
    const salt = randomBytes(SALT_LENGTH);
    const key = await derive(password, salt, COST, KEY_LENGTH);
    return [
      "scrypt",
      COST.N,
      COST.r,
      COST.p,
      salt.toString("base64"),
      key.toString("base64"),
    ].join("$");
  }

  /** Returns false for a wrong password and for a malformed stored hash. Never throws. */
  async verify(password: string, storedHash: string): Promise<boolean> {
    const [scheme, n, r, p, saltB64, keyB64] = storedHash.split("$");
    if (scheme !== "scrypt" || !n || !r || !p || !saltB64 || !keyB64) {
      return false;
    }

    try {
      const expected = Buffer.from(keyB64, "base64");
      const actual = await derive(
        password,
        Buffer.from(saltB64, "base64"),
        { N: Number(n), r: Number(r), p: Number(p) },
        expected.length
      );
      // Constant-time comparison, so timing does not reveal how close a guess was.
      return timingSafeEqual(actual, expected);
    } catch {
      return false;
    }
  }
}
