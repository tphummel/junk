import { Hono } from "hono";

const app = new Hono();

const THROWS = ["rock", "paper", "scissors"] as const;

// GET /api/rps-bot/calvin -> { "throw": "rock" | "paper" | "scissors" }
// Throw is the Worker's current time in ms, modulo 3.
// The Cloudflare request id (cf-ray) is echoed in the X-Request-Id header when present.
app.get("/calvin", (c) => {
  const throwName = THROWS[Date.now() % 3];
  const rayId = c.req.header("cf-ray");
  if (rayId) c.header("X-Request-Id", rayId);
  c.header("Cache-Control", "no-store");
  return c.json({ throw: throwName });
});

export default app;
