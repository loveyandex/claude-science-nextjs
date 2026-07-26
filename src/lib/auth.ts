import { SignJWT, jwtVerify } from "jose";
import bcrypt from "bcryptjs";
import { timingSafeEqual } from "node:crypto";

const JWT_SECRET = process.env.JWT_SECRET;

if (!JWT_SECRET) {
  // Not throwing at import time — same pattern as the AI provider warnings
  // elsewhere in this project — so the app still boots without one
  // configured, but every auth call will fail loudly and specifically.
  console.warn(
    "[auth] JWT_SECRET is not set — signup/login/token verification will fail until it's configured in .env"
  );
}

const encodedSecret = new TextEncoder().encode(JWT_SECRET || "dev-only-insecure-fallback-secret");

const TOKEN_TTL = "7d";
const BCRYPT_ROUNDS = 12;

export type JwtPayload = {
  sub: string; // user id
  email: string;
};

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, BCRYPT_ROUNDS);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export async function signToken(payload: JwtPayload): Promise<string> {
  return new SignJWT({ email: payload.email })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(payload.sub)
    .setIssuedAt()
    .setExpirationTime(TOKEN_TTL)
    .sign(encodedSecret);
}

export async function verifyToken(token: string): Promise<JwtPayload | null> {
  try {
    const { payload } = await jwtVerify(token, encodedSecret);
    if (typeof payload.sub !== "string" || typeof payload.email !== "string") return null;
    return { sub: payload.sub, email: payload.email };
  } catch {
    return null;
  }
}

/**
 * Reads and verifies the `Authorization: Bearer <token>` header from a
 * Request. Every protected API route calls this first and 401s on `null`.
 */
export async function getAuthFromRequest(req: Request): Promise<JwtPayload | null> {
  const header = req.headers.get("authorization") || req.headers.get("Authorization");
  if (!header?.startsWith("Bearer ")) return null;
  const token = header.slice("Bearer ".length).trim();
  if (!token) return null;
  return verifyToken(token);
}

export function unauthorized(message = "Unauthorized"): Response {
  return Response.json({ error: message }, { status: 401 });
}

/**
 * Checks the `X-Internal-Secret` header used by the gemma4-indexing FastAPI
 * backend (backend/main.py) to call back into Next.js — server-to-server,
 * so there's no user JWT involved, just a shared secret both sides read
 * from INTERNAL_API_SECRET.
 */
export function checkInternalSecret(req: Request): boolean {
  const expected = process.env.INTERNAL_API_SECRET;
  const provided = req.headers.get("x-internal-secret");
  if (!expected || !provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
