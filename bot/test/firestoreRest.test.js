// Exercises the real JWT-signing + REST plumbing end to end, with fetch
// mocked at the network boundary (Google's OAuth token endpoint and the
// Firestore REST API itself). This is the highest-risk, least-standard part
// of the bot (no firebase-admin SDK to lean on in the Workers runtime), so
// it's worth testing against something closer to the real wire format than
// mocking firestoreRest.js's own exports.
import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import {
  getDocument,
  patchDocument,
  createDocument,
  deleteDocument,
  queryEquals,
  _resetTokenCacheForTests,
} from "../src/firestoreRest.js";

async function generateTestPrivateKeyPem() {
  const keyPair = await crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true,
    ["sign", "verify"]
  );
  const pkcs8 = await crypto.subtle.exportKey("pkcs8", keyPair.privateKey);
  const b64 = Buffer.from(pkcs8).toString("base64");
  const lines = b64.match(/.{1,64}/g).join("\n");
  return `-----BEGIN PRIVATE KEY-----\n${lines}\n-----END PRIVATE KEY-----\n`;
}

let env;

beforeAll(async () => {
  env = {
    FIREBASE_PROJECT_ID: "demo-project",
    GOOGLE_SERVICE_ACCOUNT_EMAIL: "bot@demo-project.iam.gserviceaccount.com",
    GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY: await generateTestPrivateKeyPem(),
  };
});

beforeEach(() => {
  _resetTokenCacheForTests();
});

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

describe("firestoreRest against mocked HTTPS", () => {
  it("signs a service-account JWT, exchanges it for a token, and fetches a document", async () => {
    const fetchMock = vi.fn(async (url, options) => {
      const href = String(url);
      if (href === "https://oauth2.googleapis.com/token") {
        expect(options.body.get("grant_type")).toBe("urn:ietf:params:oauth:grant-type:jwt-bearer");
        const jwt = options.body.get("assertion");
        expect(jwt.split(".")).toHaveLength(3); // header.claims.signature
        return jsonResponse({ access_token: "fake-access-token", expires_in: 3600 });
      }
      if (href.endsWith("/documents/menu/data")) {
        expect(options.headers.Authorization).toBe("Bearer fake-access-token");
        return jsonResponse({
          name: "projects/demo-project/databases/(default)/documents/menu/data",
          fields: { restaurantName: { stringValue: "Masseria" } },
        });
      }
      throw new Error(`Unexpected fetch to ${href}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const doc = await getDocument(env, "menu/data");
    expect(doc).toEqual({ id: "data", restaurantName: "Masseria" });

    vi.unstubAllGlobals();
  });

  it("caches the access token across calls instead of re-minting it every time", async () => {
    let tokenRequests = 0;
    const fetchMock = vi.fn(async (url) => {
      const href = String(url);
      if (href === "https://oauth2.googleapis.com/token") {
        tokenRequests += 1;
        return jsonResponse({ access_token: "fake-access-token", expires_in: 3600 });
      }
      return jsonResponse({ name: "projects/demo-project/databases/(default)/documents/menu/data", fields: {} });
    });
    vi.stubGlobal("fetch", fetchMock);

    await getDocument(env, "menu/data");
    await getDocument(env, "menu/data");
    expect(tokenRequests).toBe(1);

    vi.unstubAllGlobals();
  });

  it("returns null for a 404 GET instead of throwing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url) => {
        if (String(url) === "https://oauth2.googleapis.com/token") {
          return jsonResponse({ access_token: "t", expires_in: 3600 });
        }
        return new Response("not found", { status: 404 });
      })
    );
    expect(await getDocument(env, "orders/does-not-exist")).toBeNull();
    vi.unstubAllGlobals();
  });

  it("patchDocument sends an updateMask covering exactly the given top-level fields", async () => {
    let capturedUrl;
    let capturedBody;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url, options) => {
        if (String(url) === "https://oauth2.googleapis.com/token") {
          return jsonResponse({ access_token: "t", expires_in: 3600 });
        }
        capturedUrl = String(url);
        capturedBody = JSON.parse(options.body);
        return jsonResponse({ name: "projects/demo-project/databases/(default)/documents/orders/abc", fields: {} });
      })
    );

    await patchDocument(env, "orders/abc", { status: "closed", closedAt: new Date("2026-01-01T00:00:00Z") });

    expect(capturedUrl).toContain("updateMask.fieldPaths=status");
    expect(capturedUrl).toContain("updateMask.fieldPaths=closedAt");
    expect(capturedBody.fields.status).toEqual({ stringValue: "closed" });
    expect(capturedBody.fields.closedAt).toEqual({ timestampValue: "2026-01-01T00:00:00.000Z" });
    vi.unstubAllGlobals();
  });

  it("createDocument posts to the collection with the given documentId", async () => {
    let capturedUrl;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url) => {
        if (String(url) === "https://oauth2.googleapis.com/token") {
          return jsonResponse({ access_token: "t", expires_in: 3600 });
        }
        capturedUrl = String(url);
        return jsonResponse({ name: "projects/demo-project/databases/(default)/documents/botPending/chat1", fields: {} });
      })
    );

    await createDocument(env, "botPending", { toolName: "close_table" }, "chat1");
    expect(capturedUrl).toContain("botPending?documentId=chat1");
    vi.unstubAllGlobals();
  });

  it("deleteDocument tolerates an already-missing document (404)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url, options) => {
        if (String(url) === "https://oauth2.googleapis.com/token") {
          return jsonResponse({ access_token: "t", expires_in: 3600 });
        }
        expect(options.method).toBe("DELETE");
        return new Response("not found", { status: 404 });
      })
    );
    await expect(deleteDocument(env, "botPending/chat1")).resolves.toBeUndefined();
    vi.unstubAllGlobals();
  });

  it("queryEquals builds an AND filter for multiple conditions and unwraps matched documents", async () => {
    let capturedBody;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url, options) => {
        if (String(url) === "https://oauth2.googleapis.com/token") {
          return jsonResponse({ access_token: "t", expires_in: 3600 });
        }
        expect(String(url)).toContain(":runQuery");
        capturedBody = JSON.parse(options.body);
        return jsonResponse([
          {
            document: {
              name: "projects/demo-project/databases/(default)/documents/orders/abc",
              fields: { tableNumber: { integerValue: "5" }, status: { stringValue: "open" } },
            },
          },
        ]);
      })
    );

    const rows = await queryEquals(env, "orders", [
      ["tableNumber", 5],
      ["status", "open"],
    ]);

    expect(capturedBody.structuredQuery.where.compositeFilter.op).toBe("AND");
    expect(rows).toEqual([{ id: "abc", tableNumber: 5, status: "open" }]);
    vi.unstubAllGlobals();
  });

  it("queryEquals filters out rows with no matching document (empty result)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url) => {
        if (String(url) === "https://oauth2.googleapis.com/token") {
          return jsonResponse({ access_token: "t", expires_in: 3600 });
        }
        return jsonResponse([{ readTime: "2026-01-01T00:00:00Z" }]); // no `document` key
      })
    );
    expect(await queryEquals(env, "staff", [["telegramChatId", "999"]])).toEqual([]);
    vi.unstubAllGlobals();
  });
});
