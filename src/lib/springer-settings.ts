import { prisma } from "@/lib/prisma";
import { getOrCreateSettings, SETTINGS_ID } from "@/lib/app-settings";

export type SpringerSettings = { pdfProviderUrl: string | null; challengeTimeoutSec: number };

export const CHALLENGE_TIMEOUT_MIN_SEC = 10;
export const CHALLENGE_TIMEOUT_MAX_SEC = 1800;

export async function getSpringerSettings(): Promise<SpringerSettings> {
  const row = await getOrCreateSettings();
  return {
    pdfProviderUrl: row.springerPdfProviderUrl,
    challengeTimeoutSec: row.springerPdfChallengeTimeoutSec,
  };
}

/** Throws with a user-facing message on invalid input. Empty provider URL clears it. */
export async function updateSpringerSettings(input: {
  pdfProviderUrl?: unknown;
  challengeTimeoutSec?: unknown;
}): Promise<SpringerSettings> {
  await getOrCreateSettings();
  const data: { springerPdfProviderUrl?: string | null; springerPdfChallengeTimeoutSec?: number } = {};

  if (input.pdfProviderUrl !== undefined) {
    const raw = typeof input.pdfProviderUrl === "string" ? input.pdfProviderUrl.trim() : "";
    let value: string | null = null;
    if (raw) {
      let parsed: URL;
      try {
        parsed = new URL(raw);
      } catch {
        throw new Error("Provider URL must be a full URL, e.g. https://myprovider.com");
      }
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        throw new Error("Provider URL must start with http:// or https://");
      }
      value = raw.replace(/\/+$/, "");
    }
    data.springerPdfProviderUrl = value;
  }

  if (input.challengeTimeoutSec !== undefined) {
    const n = Number(input.challengeTimeoutSec);
    if (!Number.isInteger(n) || n < CHALLENGE_TIMEOUT_MIN_SEC || n > CHALLENGE_TIMEOUT_MAX_SEC) {
      throw new Error(
        `CAPTCHA wait must be a whole number of seconds between ${CHALLENGE_TIMEOUT_MIN_SEC} and ${CHALLENGE_TIMEOUT_MAX_SEC}`
      );
    }
    data.springerPdfChallengeTimeoutSec = n;
  }

  await prisma.appSettings.update({ where: { id: SETTINGS_ID }, data });
  return getSpringerSettings();
}
