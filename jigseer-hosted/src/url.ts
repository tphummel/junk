/** Where the app is mounted in api/index.ts. Every link, form action, redirect and share URL goes through url(). */
export const BASE = "/jigseer";

export function url(path = "/"): string {
  if (!path.startsWith("/")) throw new Error(`url() needs a root-relative path, got "${path}"`);
  return path === "/" ? `${BASE}/` : `${BASE}${path}`;
}
