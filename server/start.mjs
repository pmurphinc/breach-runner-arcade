/**
 * Production entry point for the Wormhole Arcade Railway service.
 *
 * Serves the built game exactly as `vinext start` does — same function, same
 * arguments — and then mounts the PvP match service on the same HTTP server,
 * so one Railway service, one injected PORT and one custom domain cover both.
 *
 * The multiplayer mount is wrapped: if it throws for any reason, the service
 * logs and carries on serving single-player. PvE must never be taken down by a
 * multiplayer fault.
 */
import path from "node:path";
import { startProdServer } from "vinext/server/prod-server";

const port = Number.parseInt(process.env.PORT ?? "3000", 10);
const host = process.env.HOST ?? "0.0.0.0";

const { server } = await startProdServer({
  port,
  host,
  outDir: path.resolve(process.cwd(), "dist"),
});

if (process.env.PVP_DISABLED === "1") {
  console.log("[pvp] disabled by PVP_DISABLED=1; serving single-player only");
} else {
  try {
    const { attachPvpServer } = await import("./pvp.mjs");
    attachPvpServer(server);
  } catch (error) {
    console.error(
      "[pvp] match service failed to start; single-player is unaffected:",
      error instanceof Error ? error.message : error
    );
  }
}
