import { Hono } from "hono";
import goldenAnglePalette from "./golden-angle-palette";
import health from "./health";

const app = new Hono();

// Mount each app's sub-router under /api/<name>. Add one import + one line per app.
app.route("/api/golden-angle-palette", goldenAnglePalette);
app.route("/api/health", health);

app.notFound((c) => c.json({ error: "not found" }, 404));

export default app;
