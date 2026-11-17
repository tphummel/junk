import { Hono } from "hono";

type Bindings = { JIGSEER_DB: D1Database };

const app = new Hono<{ Bindings: Bindings }>();

app.get("/status", (c) => {
  c.header("Cache-Control", "no-store");
  return c.json({ status: "ok" });
});

app.get("/health", async (c) => {
  c.header("Cache-Control", "no-store");
  let healthy = false;
  try {
    const row = await c.env.JIGSEER_DB.prepare("SELECT 1 AS ok").first<{ ok: number }>();
    healthy = row?.ok === 1;
  } catch {
    healthy = false;
  }
  const cf = (c.req.raw as { cf?: { colo?: string } }).cf;
  return c.json(
    {
      status: healthy ? "ok" : "error",
      database: { healthy },
      colo: cf?.colo ?? null,
      timestamp: new Date().toISOString(),
    },
    healthy ? 200 : 500,
  );
});

export default app;
