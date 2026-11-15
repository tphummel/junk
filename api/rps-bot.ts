import { Hono } from "hono";

const app = new Hono();

const THROWS = ["rock", "paper", "scissors"] as const;

// GET /api/rps-bot/calvin -> { "throw": "rock" | "paper" | "scissors", "timestamp": <ms>, "id": <cf-ray | null> }
// Throw is the Worker's current time in ms, modulo 3.
// timestamp is the Worker time in ms; id is the Cloudflare request id (cf-ray), also sent as X-Request-Id.
app.get("/calvin", (c) => {
  const timestamp = Date.now();
  const throwName = THROWS[timestamp % 3];
  const rayId = c.req.header("cf-ray");
  if (rayId) c.header("X-Request-Id", rayId);
  c.header("Cache-Control", "no-store");
  return c.json({ throw: throwName, timestamp, id: rayId ?? null });
});

export default app;
