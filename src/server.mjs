import http from "node:http";
import { approveRecord, createDemoQueue, renderPage, toPublicRecord } from "./demo.mjs";

const port = Number(process.env.PORT ?? 3344);
const host = process.env.HOST ?? "127.0.0.1";
const { gate, queue } = await createDemoQueue();

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", `http://${request.headers.host}`);

  if (request.method === "GET" && url.pathname === "/") {
    return sendHtml(response, renderPage(queue));
  }

  if (request.method === "GET" && url.pathname === "/api/intents") {
    return sendJson(response, [...queue.values()].map(toPublicRecord));
  }

  if (request.method === "POST" && url.pathname.startsWith("/approve/")) {
    const intentId = decodeURIComponent(url.pathname.slice("/approve/".length));
    const record = queue.get(intentId);
    if (!record) return sendJson(response, { error: "Unknown intent." }, 404);
    const result = await approveRecord(gate, record);
    if (result.error) return sendJson(response, { error: result.error }, result.status);
    return sendJson(response, toPublicRecord(result.record));
  }

  return sendJson(response, { error: "Not found." }, 404);
});

server.listen(port, host, () => {
  console.log(`Starter approval app running at http://${host}:${port}`);
});

function sendHtml(response, body) {
  response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  response.end(body);
}

function sendJson(response, body, status = 200) {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body, null, 2));
}
