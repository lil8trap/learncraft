/** Server-side Gemini API adapter. Never import from client components. */
// These models have Google-listed free-tier text input/output (subject to quotas).
// This code cannot enable billing; keep the Google AI Studio project on Free Tier.
const MODELS = [
  "gemini-3.5-flash-lite",
  "gemini-3.1-flash-lite",
  "gemini-3.8-flash",
] as const;
export const GEMINI_MODEL = MODELS[0];
type GeminiModel = (typeof MODELS)[number];

type GeminiResponse = {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string }> };
    finishReason?: string;
  }>;
};

type GeminiOptions = {
  json?: boolean;
  maxOutputTokens?: number;
  timeoutMs?: number;
};

export class GeminiRequestError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
    this.name = "GeminiRequestError";
  }
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Return the actual model used, so the API response never mislabels a fallback. */
export async function generateGeminiTextWithModel(
  prompt: string,
  options: GeminiOptions = {},
): Promise<{ text: string; model: GeminiModel }> {
  const key = process.env.GEMINI_API_KEY?.trim();
  if (!key) throw new GeminiRequestError(503, "Gemini is not configured yet.");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 35_000);
  const body = JSON.stringify({
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: options.json ? 0.35 : 0.25,
      maxOutputTokens: options.maxOutputTokens ?? 2048,
      ...(options.json ? { responseMimeType: "application/json" } : {}),
    },
  });

  try {
    for (const model of MODELS) {
      // One extra attempt on the primary model; one request per fallback model.
      const attempts = model === GEMINI_MODEL ? 2 : 1;
      for (let attempt = 0; attempt < attempts; attempt += 1) {
        const response = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json", "x-goog-api-key": key },
            body,
            signal: controller.signal,
            cache: "no-store",
          },
        );

        if (response.ok) {
          const payload = (await response.json()) as GeminiResponse;
          const text = payload.candidates?.[0]?.content?.parts
            ?.map((part) => part.text ?? "")
            .join("")
            .trim();
          if (!text) {
            throw new GeminiRequestError(502, "The AI returned no text. Try shorter notes.");
          }
          if (model !== GEMINI_MODEL) {
            console.info("Gemini fallback model responded:", model);
          }
          return { text, model };
        }

        // Never log response bodies, prompts, or API keys.
        const errorBody = (await response.json().catch(() => null)) as {
          error?: { status?: string };
        } | null;
        console.warn("Gemini API error:", {
          model,
          httpStatus: response.status,
          category: errorBody?.error?.status ?? "UNKNOWN",
        });

        // Do not evade free-tier quotas or retry authentication/configuration errors.
        if (response.status === 429) {
          throw new GeminiRequestError(429, "Free AI capacity has been reached. Try again later.");
        }
        if (response.status === 401 || response.status === 403) {
          throw new GeminiRequestError(503, "Gemini API access is unavailable. Check your free-tier key.");
        }
        if (response.status === 400) {
          throw new GeminiRequestError(502, "The AI provider rejected this request.");
        }
        if (![404, 500, 502, 503, 504].includes(response.status)) {
          throw new GeminiRequestError(502, "The AI provider rejected this request.");
        }
        if (model === GEMINI_MODEL && response.status === 503 && attempt === 0) {
          await sleep(1000);
          continue;
        }
        // The current model is unavailable: advance to the next known free-tier model.
        break;
      }
    }
    throw new GeminiRequestError(
      502,
      "Gemini is busy across the available free-tier models. Please try again later.",
    );
  } catch (error) {
    if (error instanceof GeminiRequestError) throw error;
    if (error instanceof Error && error.name === "AbortError") {
      throw new GeminiRequestError(504, "AI generation took too long. Try shorter notes.");
    }
    console.error("Gemini network request failed");
    throw new GeminiRequestError(502, "Couldn't connect to the AI provider.");
  } finally {
    clearTimeout(timer);
  }
}

export async function generateGeminiText(
  prompt: string,
  options: GeminiOptions = {},
): Promise<string> {
  const result = await generateGeminiTextWithModel(prompt, options);
  return result.text;
}

export function geminiErrorResponse(error: unknown): Response {
  if (error instanceof GeminiRequestError) {
    return Response.json({ message: error.message }, { status: error.status });
  }
  console.error("Gemini returned invalid data");
  return Response.json(
    { message: "AI generated an invalid response. Please try again." },
    { status: 502 },
  );
}
