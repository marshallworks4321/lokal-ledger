import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { authCookieOptions, getSupabaseConfig } from "@/lib/supabase/client";

type InsightInput = {
  sales: number;
  collected: number;
  estimatedProductGrossProfit: number;
  outstandingDebt: number;
  inventoryValueAtCost: number;
  inventoryProductsWithCost: number;
  productSalesWithoutCost: number;
  stockWatch: Array<{ name: string; quantity: number; alertAt: number }>;
  topProducts: Array<{ name: string; quantity: number; sales: number }>;
};

const responseHeaders = { "Cache-Control": "no-store" };

function respond(message: string, status: number) {
  return Response.json({ message }, { status, headers: responseHeaders });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validAmount(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function validateInput(value: unknown): InsightInput | null {
  if (!isRecord(value)) return null;
  const numericFields = [
    "sales",
    "collected",
    "estimatedProductGrossProfit",
    "outstandingDebt",
    "inventoryValueAtCost",
    "inventoryProductsWithCost",
    "productSalesWithoutCost",
  ] as const;
  if (numericFields.some((field) => !validAmount(value[field]))) return null;
  if (!Array.isArray(value.stockWatch) || value.stockWatch.length > 15) return null;
  if (!Array.isArray(value.topProducts) || value.topProducts.length > 10) return null;
  const stockWatch = value.stockWatch.flatMap((item) =>
    isRecord(item) && typeof item.name === "string" && item.name.length <= 160 &&
    Number.isSafeInteger(item.quantity) && Number(item.quantity) >= 0 &&
    Number.isSafeInteger(item.alertAt) && Number(item.alertAt) >= 0
      ? [{ name: item.name, quantity: Number(item.quantity), alertAt: Number(item.alertAt) }]
      : [],
  );
  const topProducts = value.topProducts.flatMap((item) =>
    isRecord(item) && typeof item.name === "string" && item.name.length <= 160 &&
    Number.isSafeInteger(item.quantity) && Number(item.quantity) >= 0 &&
    validAmount(item.sales)
      ? [{ name: item.name, quantity: Number(item.quantity), sales: Number(item.sales) }]
      : [],
  );
  if (stockWatch.length !== value.stockWatch.length || topProducts.length !== value.topProducts.length) {
    return null;
  }
  return {
    sales: Number(value.sales),
    collected: Number(value.collected),
    estimatedProductGrossProfit: Number(value.estimatedProductGrossProfit),
    outstandingDebt: Number(value.outstandingDebt),
    inventoryValueAtCost: Number(value.inventoryValueAtCost),
    inventoryProductsWithCost: Number(value.inventoryProductsWithCost),
    productSalesWithoutCost: Number(value.productSalesWithoutCost),
    stockWatch,
    topProducts,
  };
}

export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) {
    return respond("This request is not allowed.", 403);
  }
  const bodyText = await request.text();
  if (bodyText.length > 12000) return respond("Insight request is too large.", 413);

  let body: unknown;
  try {
    body = JSON.parse(bodyText);
  } catch {
    return respond("Send a valid insight request.", 400);
  }
  const input = validateInput(body);
  if (!input) return respond("Business insight data is invalid.", 400);

  const config = getSupabaseConfig();
  if (!config) return respond("Supabase authentication is not configured on this server.", 503);
  const cookieStore = await cookies();
  const supabase = createServerClient(config.url, config.publishableKey, {
    cookieOptions: authCookieOptions,
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
      },
    },
  });
  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError?.name === "AuthSessionMissingError") return respond("Sign in to generate business insights.", 401);
  if (authError) return respond("Could not verify your Supabase session. Try again.", 503);
  if (!authData.user) return respond("Sign in to generate business insights.", 401);

  const { data: subscriptionAllowed, error: subscriptionError } = await supabase.rpc("current_user_has_active_subscription");
  if (subscriptionError) return respond("Could not verify your trial or subscription. Apply the latest billing migration and try again.", 503);
  if (subscriptionAllowed !== true) return respond("Your free trial has ended. The business owner must subscribe before generating insights.", 402);

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return respond("Gemini insights are not configured. Add GEMINI_API_KEY to the server environment.", 503);
  const model = process.env.GEMINI_MODEL?.trim() || "gemini-3.8-flash";
  if (!/^gemini-[a-z0-9.-]+$/i.test(model)) {
    return respond("GEMINI_MODEL must be a valid Gemini model ID.", 503);
  }
  const { data: requestAllowed, error: rateLimitError } = await supabase.rpc("consume_smart_log_request");
  if (rateLimitError) return respond("Could not verify the AI request limit. Try again shortly.", 503);
  if (requestAllowed !== true) return respond("AI tools are limited to 10 requests per minute. Wait a moment and try again.", 429);

  let providerResponse: Response;
  try {
    providerResponse = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
      {
        method: "POST",
        headers: {
          "x-goog-api-key": apiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          systemInstruction: {
            parts: [{
              text: "You are a careful business analyst for a small merchant. Analyze only the supplied aggregated data. Return JSON with an insights array of 2 to 4 short, actionable observations. Do not invent causes, costs, or comparisons. Identify gross profit as an estimate, not net profit. If product sales without cost data are present, explicitly mention that estimate excludes them. If inventory value is zero because no unit costs are known, say so plainly. Do not include customer data or suggest external actions.",
            }],
          },
          contents: [{
            role: "user",
            parts: [{ text: JSON.stringify(input) }],
          }],
          generationConfig: {
            responseMimeType: "application/json",
            responseSchema: {
              type: "OBJECT",
              properties: {
                insights: {
                  type: "ARRAY",
                  items: { type: "STRING" },
                },
              },
              required: ["insights"],
              propertyOrdering: ["insights"],
            },
            temperature: 0.2,
            maxOutputTokens: 300,
          },
        }),
        signal: AbortSignal.timeout(45_000),
        cache: "no-store",
      },
    );
  } catch (reason) {
    return respond(
      reason instanceof Error && reason.name === "TimeoutError"
        ? "Gemini did not respond within 45 seconds. Try again later."
        : "The server could not connect to Gemini. Check the connection and try again.",
      reason instanceof Error && reason.name === "TimeoutError" ? 504 : 502,
    );
  }

  if (!providerResponse.ok) {
    if (providerResponse.status === 401 || providerResponse.status === 403) {
      return respond("Google rejected GEMINI_API_KEY. Check that the key is active.", 502);
    }
    if (providerResponse.status === 404) {
      return respond(`Gemini could not find model "${model}". Set GEMINI_MODEL to an available model.`, 502);
    }
    if (providerResponse.status === 503) return respond("Gemini is temporarily overloaded. Try again shortly.", 503);
    if (providerResponse.status === 429) return respond("Gemini is busy or its API quota was reached. Try again later.", 429);
    return respond("Gemini could not prepare these insights. Try again later.", 502);
  }

  let providerBody: unknown;
  try {
    providerBody = await providerResponse.json();
  } catch {
    return respond("Gemini returned an unreadable response.", 502);
  }
  if (!isRecord(providerBody) || !Array.isArray(providerBody.candidates)) {
    return respond("Gemini returned an invalid response.", 502);
  }
  const candidate = providerBody.candidates[0];
  if (!isRecord(candidate) || !isRecord(candidate.content) || !Array.isArray(candidate.content.parts)) {
    return respond("Gemini did not return business insights.", 502);
  }
  const text = candidate.content.parts
    .flatMap((part) => isRecord(part) && typeof part.text === "string" && part.thought !== true ? [part.text] : [])
    .join("");
  if (!text) return respond("Gemini returned an empty insight response.", 502);

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return respond("Gemini returned an unreadable insight summary.", 502);
  }
  if (!isRecord(parsed) || !Array.isArray(parsed.insights)) {
    return respond("Gemini returned an invalid insight summary.", 502);
  }
  const insights = parsed.insights.filter(
    (insight): insight is string => typeof insight === "string" && insight.trim().length > 0 && insight.length <= 400,
  ).slice(0, 4);
  if (insights.length === 0) return respond("Gemini did not provide any actionable observations.", 502);
  return Response.json({ insights }, { headers: responseHeaders });
}
