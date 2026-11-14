import { Hono } from "hono";
import health from "./health";

const app = new Hono();

// Mount each app's sub-router under /api/<name>. Add one import + one line per app.
app.route("/api/health", health);

app.notFound((c) => c.json({ error: "not found" }, 404));

export default app;
