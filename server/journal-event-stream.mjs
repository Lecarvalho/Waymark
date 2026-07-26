import { statSync } from "node:fs";

function databaseSignature(databasePath) {
  return [databasePath, `${databasePath}-wal`, `${databasePath}-shm`]
    .map((path) => {
      try {
        const stat = statSync(path);
        return `${stat.mtimeMs}:${stat.size}`;
      } catch {
        return "missing";
      }
    })
    .join("|");
}

function eventPayload(event, now) {
  return `event: ${event}\ndata: ${JSON.stringify({
    at: now().toISOString(),
  })}\n\n`;
}

export function createJournalEventStream({
  databasePath,
  now = () => new Date(),
  pollIntervalMs = 500,
  heartbeatIntervalMs = 20_000,
}) {
  const clients = new Set();
  const broadcast = (event = "changed") => {
    const payload = eventPayload(event, now);
    for (const response of clients) response.write(payload);
  };

  let signature = databaseSignature(databasePath);
  const changeTimer = setInterval(() => {
    const next = databaseSignature(databasePath);
    if (next !== signature) {
      signature = next;
      broadcast();
    }
  }, pollIntervalMs);
  changeTimer.unref();

  const heartbeatTimer = setInterval(
    () => broadcast("heartbeat"),
    heartbeatIntervalMs,
  );
  heartbeatTimer.unref();

  return {
    register(request, response) {
      response.writeHead(200, {
        "access-control-allow-origin": "*",
        "cache-control": "no-cache, no-transform",
        connection: "keep-alive",
        "content-type": "text/event-stream",
      });
      response.write(eventPayload("ready", now));
      clients.add(response);
      request.on("close", () => clients.delete(response));
    },
    close() {
      clearInterval(changeTimer);
      clearInterval(heartbeatTimer);
      for (const response of clients) response.end();
      clients.clear();
    },
  };
}
