type PublicApiRoute = "generate" | "chat";
type RateLimitBucket = { count: number; resetAt: number };

const PUBLIC_API_LIMITS: Record<
  PublicApiRoute,
  { requests: number; windowMs: number }
> = {
  generate: { requests: 15, windowMs: 15 * 60 * 1_000 },
  chat: { requests: 25, windowMs: 15 * 60 * 1_000 },
};

// This small per-instance limiter is intended for a public portfolio demo.
// Production-scale abuse protection should also be enabled at the host/CDN.
const rateLimitBuckets = new Map<string, RateLimitBucket>();

function jsonResponse(
  message: string,
  status: number,
  headers: Record<string, string> = {},
) {
  return new Response(JSON.stringify({ message }), {
    status,
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "application/json; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
      ...headers,
    },
  });
}

function cleanExpiredBuckets(now: number) {
  if (rateLimitBuckets.size < 2_000) return;

  for (const [key, bucket] of rateLimitBuckets) {
    if (bucket.resetAt <= now || rateLimitBuckets.size > 2_500) {
      rateLimitBuckets.delete(key);
    }
  }
}

function getClientAddress(request: Request) {
  const forwardedFor = request.headers.get("X-Forwarded-For");
  return (
    forwardedFor?.split(",")[0]?.trim() ||
    request.headers.get("X-Real-IP") ||
    "unknown"
  );
}

function guardApiRequest(request: Request, route: PublicApiRoute) {
  const requestUrl = new URL(request.url);
  const origin = request.headers.get("Origin");
  const fetchSite = request.headers.get("Sec-Fetch-Site");

  if (
    !origin ||
    origin !== requestUrl.origin ||
    (fetchSite && fetchSite !== "same-origin")
  ) {
    return {
      response: jsonResponse(
        "Requests must come from the LearnCraft website.",
        403,
      ),
    };
  }

  const contentType = request.headers.get("Content-Type") ?? "";
  if (!contentType.toLowerCase().includes("application/json")) {
    return {
      response: jsonResponse("LearnCraft accepts JSON requests only.", 415),
    };
  }

  const contentLength = Number(request.headers.get("Content-Length") ?? "0");
  if (Number.isFinite(contentLength) && contentLength > 85_000) {
    return {
      response: jsonResponse(
        "That request is too large for the public demo.",
        413,
      ),
    };
  }

  const now = Date.now();
  cleanExpiredBuckets(now);
  const rule = PUBLIC_API_LIMITS[route];
  const key = `${route}:${getClientAddress(request)}`;
  const current = rateLimitBuckets.get(key);
  const bucket =
    !current || current.resetAt <= now
      ? { count: 1, resetAt: now + rule.windowMs }
      : { count: current.count + 1, resetAt: current.resetAt };
  rateLimitBuckets.set(key, bucket);

  const remaining = Math.max(0, rule.requests - bucket.count);
  const retryAfter = Math.max(
    1,
    Math.ceil((bucket.resetAt - now) / 1_000),
  );

  if (bucket.count > rule.requests) {
    return {
      response: jsonResponse(
        "Public demo limit reached. Please try again in a few minutes.",
        429,
        {
          "Retry-After": String(retryAfter),
          "X-RateLimit-Limit": String(rule.requests),
          "X-RateLimit-Remaining": "0",
        },
      ),
    };
  }

  return { limit: rule.requests, remaining };
}

export async function withPublicApiProtection(
  request: Request,
  route: PublicApiRoute,
  handle: () => Promise<Response>,
) {
  const decision = guardApiRequest(request, route);
  if (decision.response) return decision.response;

  const response = await handle();
  const headers = new Headers(response.headers);
  headers.set("Cache-Control", "no-store");
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("X-RateLimit-Limit", String(decision.limit));
  headers.set("X-RateLimit-Remaining", String(decision.remaining));

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
