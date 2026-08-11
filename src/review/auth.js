const cookieName = "bhe_review_session";
const sessionVersion = "v1";
const sessionLifetimeSeconds = 60 * 60 * 24 * 30;

function secretKey(secret) {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

function toHex(buffer) {
  return [...new Uint8Array(buffer)]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}

function fromHex(value) {
  if (!/^[0-9a-f]{64}$/u.test(value)) return null;
  const bytes = new Uint8Array(32);
  for (let index = 0; index < value.length; index += 2) {
    bytes[index / 2] = Number.parseInt(value.slice(index, index + 2), 16);
  }
  return bytes;
}

function cookieValue(request) {
  const cookies = request.headers.get("cookie") ?? "";
  for (const part of cookies.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === cookieName) return rest.join("=");
  }
  return null;
}

export function validReviewSecret(secret) {
  return typeof secret === "string" && secret.length >= 32 && secret.length <= 256;
}

export async function verifyAdminToken(supplied, secret) {
  if (!validReviewSecret(secret) || typeof supplied !== "string" || supplied.length > 256) return false;
  const message = new TextEncoder().encode("biomedical-hydrogen-evidence:review-admin-token:v1");
  const suppliedKey = await secretKey(supplied);
  const suppliedSignature = await crypto.subtle.sign("HMAC", suppliedKey, message);
  const expectedKey = await secretKey(secret);
  return crypto.subtle.verify("HMAC", expectedKey, suppliedSignature, message);
}

export async function createReviewSession(secret, now = Date.now()) {
  if (!validReviewSecret(secret)) throw new Error("Review admin secret is not configured safely");
  const expires = Math.floor(now / 1000) + sessionLifetimeSeconds;
  const payload = `${sessionVersion}.${expires}`;
  const key = await secretKey(secret);
  const signature = toHex(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload)));
  return `${payload}.${signature}`;
}

export async function verifyReviewSession(request, secret, now = Date.now()) {
  if (!validReviewSecret(secret)) return false;
  const value = cookieValue(request);
  const match = /^(v1)\.(\d{10})\.([0-9a-f]{64})$/u.exec(value ?? "");
  if (!match || Number(match[2]) <= Math.floor(now / 1000)) return false;
  const key = await secretKey(secret);
  const signature = fromHex(match[3]);
  return crypto.subtle.verify(
    "HMAC",
    key,
    signature,
    new TextEncoder().encode(`${match[1]}.${match[2]}`),
  );
}

export function reviewSessionCookie(value, request) {
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return `${cookieName}=${value}; Path=/; Max-Age=${sessionLifetimeSeconds}; HttpOnly; SameSite=Strict${secure}`;
}

export function expiredReviewSessionCookie(request) {
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return `${cookieName}=; Path=/; Max-Age=0; HttpOnly; SameSite=Strict${secure}`;
}
