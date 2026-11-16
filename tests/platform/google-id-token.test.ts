// GoogleIdTokenVerifier with real RS256 signatures: a key pair made here stands in for
// Google's, and the key fetch is replaced so no network call is made.
import { generateKeyPairSync, type JsonWebKey } from "node:crypto";
import jwt from "jsonwebtoken";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { GoogleIdTokenVerifier } from "../../src/core/security/GoogleIdTokenVerifier.js";
import { closeTestApp, redis, resetState } from "../helpers/testApp.js";

const CLIENT_ID = "test-web-client.apps.googleusercontent.com";
const KEY_ID = "test-key-1";

const googleKeys = generateKeyPairSync("rsa", { modulusLength: 2048 });
const attackerKeys = generateKeyPairSync("rsa", { modulusLength: 2048 });
const publicJwk: JsonWebKey = {
  ...googleKeys.publicKey.export({ format: "jwk" }),
  kid: KEY_ID,
  alg: "RS256",
  use: "sig",
};

let keyFetchCount = 0;
const createVerifier = () =>
  new GoogleIdTokenVerifier(redis, [CLIENT_ID], () => {
    keyFetchCount++;
    return Promise.resolve({ keys: [publicJwk], maxAgeSeconds: 3600 });
  });

const validClaims = {
  sub: "1234567890",
  email: "Student@Gmail.Test",
  email_verified: true,
  name: "Asha Rao",
  picture: "https://lh3.googleusercontent.com/a/photo",
};

function googleIdToken(
  claims: Record<string, unknown> = validClaims,
  options: jwt.SignOptions = {},
  privateKey = googleKeys.privateKey
) {
  return jwt.sign(claims, privateKey, {
    algorithm: "RS256",
    keyid: KEY_ID,
    issuer: "https://accounts.google.com",
    audience: CLIENT_ID,
    expiresIn: 300,
    ...options,
  });
}

beforeEach(async () => {
  await resetState();
  keyFetchCount = 0;
});
afterAll(closeTestApp);

describe("GoogleIdTokenVerifier", () => {
  it("returns the identity for a valid token, with the email in lowercase", async () => {
    const identity = await createVerifier().verify(googleIdToken());
    expect(identity).toEqual({
      googleAccountId: "1234567890",
      email: "student@gmail.test",
      name: "Asha Rao",
      avatarUrl: "https://lh3.googleusercontent.com/a/photo",
    });
  });

  it("uses the email name when Google sends no name", async () => {
    const { name: _name, ...claimsWithoutName } = validClaims;
    const identity = await createVerifier().verify(
      googleIdToken(claimsWithoutName)
    );
    expect(identity.name).toBe("student");
  });

  it("rejects a forged signature, another audience, another issuer and an expired token", async () => {
    const verifier = createVerifier();
    const badTokens = [
      googleIdToken(validClaims, {}, attackerKeys.privateKey),
      googleIdToken(validClaims, { audience: "someone-elses-app" }),
      googleIdToken(validClaims, { issuer: "https://evil.example" }),
      googleIdToken(validClaims, { expiresIn: -10 }),
      "not-a-jwt",
    ];
    for (const token of badTokens) {
      await expect(verifier.verify(token)).rejects.toThrow(
        "Google sign-in failed"
      );
    }
  });

  it("rejects an unverified email", async () => {
    const token = googleIdToken({ ...validClaims, email_verified: false });
    await expect(createVerifier().verify(token)).rejects.toThrow(
      "Google sign-in failed"
    );
  });

  it("rejects a token signed with another algorithm", async () => {
    const hmacToken = jwt.sign(validClaims, "shared-secret", {
      algorithm: "HS256",
      keyid: KEY_ID,
      issuer: "https://accounts.google.com",
      audience: CLIENT_ID,
    });
    await expect(createVerifier().verify(hmacToken)).rejects.toThrow(
      "Google sign-in failed"
    );
  });

  it("fetches Google's keys once and then reads them from Redis", async () => {
    await createVerifier().verify(googleIdToken());
    await createVerifier().verify(googleIdToken()); // a second API instance
    expect(keyFetchCount).toBe(1);
    expect(await redis.ttl("google:jwks")).toBeGreaterThan(0);
  });

  it("refetches at most once a minute for unknown key ids", async () => {
    const verifier = createVerifier();
    const unknownKeyToken = googleIdToken(validClaims, { keyid: "rotated" });
    for (let attempt = 0; attempt < 3; attempt++) {
      await expect(verifier.verify(unknownKeyToken)).rejects.toThrow(
        "Google sign-in failed"
      );
    }
    expect(keyFetchCount).toBe(1);
  });

  it("fails sign-in, without crashing, when Google can't be reached", async () => {
    const verifier = new GoogleIdTokenVerifier(redis, [CLIENT_ID], () =>
      Promise.reject(new Error("network down"))
    );
    await expect(verifier.verify(googleIdToken())).rejects.toThrow(
      "Google sign-in failed"
    );
  });
});
