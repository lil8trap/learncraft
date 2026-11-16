/** Server-side Gemini API adapter. Never import from client components. */
export const GEMINI_MODEL = "gemini-3.5-flash-lite" as const;

type GeminiResponse = {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string }> };
    finishReason?: string;
  }>;
};

export class GeminiRequestError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
    this.name = "GeminiRequestError";
  }
}

export async function generateGeminiText(
  prompt: string,
  options: { json?: boolean; maxOutputTokens?: number; timeoutMs?: number } = {},
): Promise<string> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new GeminiRequestError(503, "Gemini is not configured yet.");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 35_000);
  try {
    for (let attempt = 0; attempt < 3; attempt++) {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": key,
        },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: options.json ? 0.35 : 0.25,
            maxOutputTokens: options.maxOutputTokens ?? 2048,
            ...(options.json ? { responseMimeType: "application/json" } : {}),
          },
        }),
        signal: controller.signal,
        cache: "no-store",
      },
    );

    if (!response.ok) {
      // Avoid logging response bodies: they can contain information from the prompt.
      
const errorBody = await response.json().catch(() => null) as {
  error?: { status?: string; message?: string };
} | null;

console.error("Gemini API error:", {
  httpStatus: response.status,
  category: errorBody?.error?.status ?? "UNKNOWN",
});

      if (response.status === 503 && attempt < 2) {
        // Retry temporary provider overload, at most twice. Keep the free-tier
        // model unchanged; do not retry 429 (quota) or authentication errors.
        const delayMs = 1000 * 2 ** attempt;
        console.warn(`Gemini is temporarily unavailable; retry ${attempt + 1}/2 in ${delayMs}ms`);
        await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
        continue;
      }
      if (response.status === 429) {
        throw new GeminiRequestError(429, "Free AI capacity has been reached. Please try again later.");
      }
      if (response.status === 400) {
        throw new GeminiRequestError(502, "The AI provider rejected this request.");
      }
      if (response.status === 401 || response.status === 403) {
        throw new GeminiRequestError(503, "Gemini API access is unavailable. Please check the API key and free-tier project.");
      }
      throw new GeminiRequestError(502, "The AI provider is temporarily unavailable.");
    }

    const data = (await response.json()) as GeminiResponse;
    const text = data.candidates?.[0]?.content?.parts
      ?.map((part) => part.text ?? "")
      .join("")
      .trim();
    if (!text) throw new GeminiRequestError(502, "The AI returned no text. Try shorter notes.");
    return text;
    }
    // Defensive fallback; normal success and error paths return or throw above.
    throw new GeminiRequestError(502, "The AI provider is temporarily unavailable.");
  } catch (error) {
    if (error instanceof GeminiRequestError) throw error;
    if (error instanceof Error && error.name === "AbortError") {
      throw new GeminiRequestError(504, "AI generation took too long. Try shorter notes.");
    }
    console.error("Gemini network request failed");
    throw new GeminiRequestError(502, "Couldn't connect to the AI provider.");
  } finally {
    clearTimeout(timeout);
  }
}

export function geminiErrorResponse(error: unknown): Response {
  if (error instanceof GeminiRequestError) {
    return Response.json({ message: error.message }, { status: error.status });
  }
  console.error("Gemini returned invalid data");
  return Response.json({ message: "AI generated an invalid response. Please try again." }, { status: 502 });
}
