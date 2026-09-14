import type { RequestHandler } from "express";

/**
 * Narrow CORS for a known list of browser origins.
 *
 * Hand-written rather than pulled from a package because the policy is four lines of intent:
 * an exact-match allowlist, two request headers, one response header, no credentials.
 */
export function cors(allowedOrigins: readonly string[]): RequestHandler {
  return (req, res, next) => {
    const origin = req.get("Origin");

    if (origin && allowedOrigins.includes(origin)) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      // The response body is identical per origin but the headers are not, so a shared cache
      // must not hand one origin's response to another.
      res.setHeader("Vary", "Origin");
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type, Idempotency-Key");
      // Without this the browser hides Idempotent-Coalesced from JavaScript even though it
      // arrives on the wire, and the concurrency lab cannot tell a leader from a waiter.
      res.setHeader("Access-Control-Expose-Headers", "Idempotent-Coalesced");
      res.setHeader("Access-Control-Max-Age", "86400");
    }

    // Answer the preflight here. An unlisted origin still gets 204, but without the headers
    // above, so the browser refuses the real request.
    if (req.method === "OPTIONS") {
      res.status(204).end();
      return;
    }

    next();
  };
}
