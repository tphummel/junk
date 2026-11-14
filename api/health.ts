import { Hono } from "hono";

const app = new Hono();

app.get("/", (c) => c.json({ ok: true, time: new Date().toISOString() }));

export default app;
