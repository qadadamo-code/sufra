/**
 * Repo-root entry for /api/ask, used when the Vercel project's Root Directory is the repository root
 * (the root vercel.json builds sufra-web/). The implementation lives in sufra-web/api/ask.ts.
 * If you set Root Directory = "sufra-web" instead, Vercel uses sufra-web/api/ask.ts directly and ignores this file.
 */
export { default } from "../sufra-web/api/ask";
// must be a literal here: Vercel reads the runtime statically from the entry file
export const config = { runtime: "edge" };
