// /admin/uploads: image uploads for the admin panel. Every route needs the UPLOAD page.
// Each describe block is one endpoint, in the order: guards → 400/413 → 404 → success.
import { existsSync } from "node:fs";
import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import request from "supertest";
import sharp from "sharp";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  MAX_UPLOAD_BYTES,
  PUBLIC_IMAGES_DIR,
  TEMP_UPLOAD_DIR,
} from "../../src/config/upload.config.js";
import { deleteLocalFile } from "../../src/utils/deleteLocalFile.js";
import { adminWith } from "../helpers/auth.js";
import {
  expectAdminPageRequired,
  MISSING_ID,
  type Route,
} from "../helpers/guards.js";
import { app, closeTestApp, prisma, resetState } from "../helpers/testApp.js";

const UPLOADS = "/api/v1/admin/uploads";

// Files created by these tests, removed again in afterAll.
const createdUrls: string[] = [];
const diskPath = (url: string) =>
  path.join(PUBLIC_IMAGES_DIR, url.replace(/^\/images\//, ""));

beforeEach(resetState);
afterAll(async () => {
  for (const url of createdUrls) await rm(diskPath(url), { force: true });
  await closeTestApp();
});

// A real, noisy (hard to compress) image.
function makeImage(format: "png" | "jpeg", width = 1200, height = 900) {
  const noise = Buffer.alloc(width * height * 3);
  for (let i = 0; i < noise.length; i++) noise[i] = (i * 31 + (i >> 3)) % 256;
  const image = sharp(noise, { raw: { width, height, channels: 3 } });
  return format === "png" ? image.png().toBuffer() : image.jpeg().toBuffer();
}

const tempFiles = async () =>
  existsSync(TEMP_UPLOAD_DIR) ? readdir(TEMP_UPLOAD_DIR) : [];

async function upload(
  auth: Record<string, string>,
  file: Buffer,
  options: { filename?: string; contentType?: string; folder?: string } = {}
) {
  const req = request(app)
    .post(`${UPLOADS}/images`)
    .set(auth)
    .attach("image", file, {
      filename: options.filename ?? "photo.png",
      contentType: options.contentType ?? "image/png",
    });
  if (options.folder) void req.field("folder", options.folder);
  const res = await req;
  if (res.body?.data?.url) createdUrls.push(res.body.data.url as string);
  return res;
}

describe("guards on /admin/uploads", () => {
  it("401 without a login and 403 without the UPLOAD page, on every route", async () => {
    const routes: Route[] = [
      ["post", `${UPLOADS}/images`],
      ["get", UPLOADS],
      ["delete", `${UPLOADS}/${MISSING_ID}`],
    ];
    await expectAdminPageRequired(routes, "UPLOAD");
  });
});

describe("POST /admin/uploads/images", () => {
  it("401/403 write nothing to disk", async () => {
    const image = await makeImage("png");
    const before = await tempFiles();

    const anonymous = await upload({}, image);
    expect(anonymous.status).toBe(401);

    const noAccess = await upload((await adminWith(["ROLE"])).auth, image);
    expect(noAccess.status).toBe(403);

    expect(await tempFiles()).toEqual(before);
    expect(await prisma.upload.count()).toBe(0);
  });

  it("400 without a file", async () => {
    const { auth } = await adminWith(["UPLOAD"]);
    const res = await request(app)
      .post(`${UPLOADS}/images`)
      .set(auth)
      .field("folder", "general");
    expect(res.status).toBe(400);
  });

  it("400 for an unknown folder; 201 for an allowed one", async () => {
    const { auth } = await adminWith(["UPLOAD"]);
    const ok = await upload(auth, await makeImage("png"), {
      folder: "profile",
    });
    expect(ok.status).toBe(201);
    expect(ok.body.data.url).toMatch(/^\/images\/profile\//);

    const bad = await upload(auth, await makeImage("png"), {
      folder: "../../src",
    });
    expect(bad.status).toBe(400);
  });

  it("400 for a non-image file renamed and labelled as an image", async () => {
    const { auth } = await adminWith(["UPLOAD"]);
    const fake = Buffer.from("#!/bin/sh\necho pwned\n".repeat(50));
    const res = await upload(auth, fake, {
      filename: "innocent.jpg",
      contentType: "image/jpeg",
    });

    expect(res.status).toBe(400);
    expect(res.body.message).toBe(
      "File is not a valid JPEG, PNG or WebP image"
    );
    expect(await prisma.upload.count()).toBe(0);
  });

  it("400 for a file type that is not on the allowlist", async () => {
    const { auth } = await adminWith(["UPLOAD"]);
    const svg = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'
    );
    for (const [filename, contentType] of [
      ["x.svg", "image/svg+xml"],
      ["x.pdf", "application/pdf"],
      ["x.html", "text/html"],
    ] as const) {
      const res = await upload(auth, svg, { filename, contentType });
      expect(res.status, contentType).toBe(400);
      expect(res.body.message).toBe(
        "Only JPEG, PNG and WebP images are allowed"
      );
    }
  });

  it("413 for a file over the size limit", async () => {
    const { auth } = await adminWith(["UPLOAD"]);
    const res = await upload(auth, Buffer.alloc(MAX_UPLOAD_BYTES + 1024));
    expect(res.status).toBe(413);
    expect(res.body.message).toBe("File is too large");
  });

  it("201 stores the image as WebP under 100 KB with a generated name", async () => {
    const { auth } = await adminWith(["UPLOAD"]);
    const res = await upload(auth, await makeImage("png"), {
      filename: "../../My Holiday Photo.png",
    });

    expect(res.status).toBe(201);
    const { url, sizeBytes, contentType, folder } = res.body.data;
    expect(url).toMatch(/^\/images\/general\/[0-9a-f-]{36}\.webp$/);
    expect(url).not.toMatch(/Holiday/);
    expect(contentType).toBe("image/webp");
    expect(folder).toBe("general");
    expect(sizeBytes).toBeLessThanOrEqual(100 * 1024);

    const stored = await sharp(diskPath(url)).metadata();
    expect(stored.format).toBe("webp");
    expect(await prisma.upload.count()).toBe(1);
  });

  it("201 and the stored image is served over HTTP", async () => {
    const { auth } = await adminWith(["UPLOAD"]);
    const { body } = await upload(auth, await makeImage("jpeg"), {
      filename: "a.jpg",
      contentType: "image/jpeg",
    });

    const res = await request(app).get(body.data.url as string);
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toBe("image/webp");
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
  });

  it("leaves no temp files behind after success or failure", async () => {
    const { auth } = await adminWith(["UPLOAD"]);
    await upload(auth, await makeImage("png"));
    await upload(auth, Buffer.from("not an image"), {
      filename: "x.png",
      contentType: "image/png",
    });
    await upload(auth, await makeImage("png"), { folder: "nope" });

    // The cleanup runs when the response closes; give it a moment.
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(await tempFiles()).toEqual([]);
  });
});

describe("GET /admin/uploads", () => {
  it("400 for a page size above 100", async () => {
    const { auth } = await adminWith(["UPLOAD"]);
    expect(
      (await request(app).get(`${UPLOADS}?limit=101`).set(auth)).status
    ).toBe(400);
  });

  it("200 lists uploads with pagination and a folder filter", async () => {
    const { auth } = await adminWith(["UPLOAD"]);
    await upload(auth, await makeImage("png", 200, 200));
    await upload(auth, await makeImage("png", 200, 200), { folder: "profile" });

    const all = await request(app).get(`${UPLOADS}?limit=1`).set(auth);
    expect(all.status).toBe(200);
    expect(all.body.data.items).toHaveLength(1);
    expect(all.body.data.meta.total).toBe(2);

    const profile = await request(app)
      .get(`${UPLOADS}?folder=profile`)
      .set(auth);
    expect(profile.body.data.items).toHaveLength(1);
    expect(profile.body.data.items[0].folder).toBe("profile");
  });
});

describe("DELETE /admin/uploads/:id", () => {
  it("400 for a path instead of an ID", async () => {
    const { auth } = await adminWith(["UPLOAD"]);
    const res = await request(app)
      .delete(`${UPLOADS}/..%2F..%2F.env`)
      .set(auth);
    expect(res.status).toBe(400);
  });

  it("200 deletes the row and the file; 404 the second time", async () => {
    const { auth } = await adminWith(["UPLOAD"]);
    const { body } = await upload(auth, await makeImage("png", 200, 200));
    const { id, url } = body.data as { id: string; url: string };
    expect(existsSync(diskPath(url))).toBe(true);

    const res = await request(app).delete(`${UPLOADS}/${id}`).set(auth);
    expect(res.status).toBe(200);
    expect(existsSync(diskPath(url))).toBe(false);
    expect(await prisma.upload.count()).toBe(0);

    const again = await request(app).delete(`${UPLOADS}/${id}`).set(auth);
    expect(again.status).toBe(404);
  });
});

describe("deleteLocalFile (utility)", () => {
  it("refuses to delete anything outside the upload folders", async () => {
    // A file that sits outside public/images and tmp/uploads.
    const outsideDir = path.resolve("tmp", "outside-test");
    const victim = path.join(outsideDir, "secret.txt");
    await mkdir(outsideDir, { recursive: true });
    await writeFile(victim, "keep me");

    const attempts = [
      victim,
      "../../.env",
      "/images/../../tmp/outside-test/secret.txt",
      "public/images/../../tmp/outside-test/secret.txt",
      "/images/general/../../../tmp/outside-test/secret.txt",
      "package.json",
      PUBLIC_IMAGES_DIR,
      "",
    ];
    for (const attempt of attempts) {
      expect(await deleteLocalFile(attempt), attempt).toBe(false);
    }
    expect(existsSync(victim)).toBe(true);
    expect(existsSync("package.json")).toBe(true);

    await rm(outsideDir, { recursive: true, force: true });
  });

  it("deletes a file inside the upload folder by URL or by path", async () => {
    const dir = path.join(PUBLIC_IMAGES_DIR, "general");
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, "by-url.webp"), "x");
    await writeFile(path.join(dir, "by-path.webp"), "x");

    expect(await deleteLocalFile("/images/general/by-url.webp")).toBe(true);
    expect(await deleteLocalFile("public/images/general/by-path.webp")).toBe(
      true
    );
    expect(await deleteLocalFile("/images/general/by-url.webp")).toBe(false);
  });
});
