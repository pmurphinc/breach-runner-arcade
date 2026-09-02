/**
 * LOCAL SCRATCH HARNESS - NOT PART OF THE REPO, DELETE BEFORE COMMITTING.
 *
 * Identical to server/start.mjs (same prod server, same attachPvpServer mount)
 * with one addition: a static handler in front of vinext's, because on Windows
 * vinext's own static serving 404s every nested path (/assets/*, /ships/*).
 * That is a platform quirk of this box, not of the game or of Railway's Linux
 * runtime, and it is the only thing standing between here and two real clients.
 */
import fs from "node:fs";
import path from "node:path";
import { startProdServer } from "vinext/server/prod-server";
import { attachPvpServer } from "./server/pvp.mjs";

const port = Number.parseInt(process.env.PORT ?? "8399", 10);
const root = path.resolve(process.cwd(), "dist", "client");

const TYPES = {
  ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css",
  ".png": "image/png", ".jpg": "image/jpeg", ".svg": "image/svg+xml",
  ".ico": "image/x-icon", ".json": "application/json", ".webp": "image/webp",
  ".woff2": "font/woff2", ".mp3": "audio/mpeg", ".wav": "audio/wav",
};

const { server } = await startProdServer({
  port,
  host: "127.0.0.1",
  outDir: path.resolve(process.cwd(), "dist"),
});

server.prependListener("request", (request, response) => {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
  } catch {
    return;
  }
  if (pathname === "/" || pathname.includes("..")) return;
  const file = path.join(root, pathname.split("/").join(path.sep));
  if (!file.startsWith(root) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return;
  response.writeHead(200, { "content-type": TYPES[path.extname(file)] ?? "application/octet-stream" });
  response.end(fs.readFileSync(file));
  request.destroy?.();
});

attachPvpServer(server);
console.log(`[duel] serving http://127.0.0.1:${port} with statics from ${root}`);
