export type PaystackResult = {
  status: boolean;
  message: string;
  data?: Record<string, unknown>;
};

export async function callPaystack<T extends PaystackResult>(
  path: string,
  init: RequestInit,
): Promise<T> {
  const secretKey = process.env.PAYSTACK_SECRET_KEY;
  if (!secretKey) throw new Error("Paystack is not configured. Add PAYSTACK_SECRET_KEY on the server.");

  const response = await fetch(`https://api.paystack.co${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${secretKey}`,
      "Content-Type": "application/json",
      ...init.headers,
    },
    cache: "no-store",
  });
  let result: unknown;
  try {
    result = await response.json();
  } catch {
    throw new Error("Paystack returned an unreadable response.");
  }
  if (
    !response.ok ||
    typeof result !== "object" ||
    result === null ||
    !("status" in result) ||
    result.status !== true
  ) {
    const message = typeof result === "object" && result !== null && "message" in result &&
      typeof result.message === "string"
      ? result.message
      : "Paystack could not complete the request.";
    throw new Error(message);
  }
  return result as T;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function getString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function getNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) ? value : null;
}
