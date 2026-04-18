import { approveRecord, createDemoQueue, renderPage, toPublicRecord } from "../src/demo.mjs";

let statePromise;

export async function onRequest(context) {
  const state = await getState();
  const url = new URL(context.request.url);

  if (context.request.method === "GET" && url.pathname === "/") {
    return html(renderPage(state.queue));
  }

  if (context.request.method === "GET" && url.pathname === "/api/intents") {
    return json([...state.queue.values()].map(toPublicRecord));
  }

  if (context.request.method === "POST" && url.pathname.startsWith("/approve/")) {
    const intentId = decodeURIComponent(url.pathname.slice("/approve/".length));
    const record = state.queue.get(intentId);
    if (!record) return json({ error: "Unknown intent." }, 404);

    const result = await approveRecord(state.gate, record);
    if (result.error) return json({ error: result.error }, result.status);
    return json(toPublicRecord(result.record));
  }

  return json({ error: "Not found." }, 404);
}

function getState() {
  statePromise ??= createDemoQueue();
  return statePromise;
}

function html(body) {
  return new Response(body, {
    headers: {
      "content-type": "text/html; charset=utf-8",
    },
  });
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
    },
  });
}

