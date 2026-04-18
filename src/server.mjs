import http from "node:http";
import { createIntentGate, createPolicy, gateOpenAIToolCall } from "@pallattu/aeg-intent-gate";

const port = Number(process.env.PORT ?? 3344);
const host = process.env.HOST ?? "127.0.0.1";
const queue = new Map();

const gate = createIntentGate({
  agent: {
    agentId: "starter-agent",
    capabilities: ["email.send", "refund.create", "user.delete"],
  },
  policies: [
    createPolicy({
      name: "block-user-delete",
      match: (intent) => intent.type === "user.delete",
      evaluate: () => ({
        outcome: "blocked",
        reason: "Deleting users is not allowed from this agent.",
      }),
    }),
    createPolicy({
      name: "review-side-effects",
      match: (intent) => ["email.send", "refund.create"].includes(intent.type),
      evaluate: () => ({
        outcome: "requires_approval",
        reason: "Side-effecting actions require human review.",
      }),
    }),
  ],
});

const proposedToolCalls = [
  {
    id: "fc_email",
    call_id: "call_email",
    type: "function_call",
    name: "email.send",
    arguments: JSON.stringify({
      to: "customer@example.com",
      subject: "Refund update",
    }),
  },
  {
    id: "fc_refund",
    call_id: "call_refund",
    type: "function_call",
    name: "refund.create",
    arguments: JSON.stringify({
      customerId: "cus_123",
      amount: 250,
    }),
  },
  {
    id: "fc_delete",
    call_id: "call_delete",
    type: "function_call",
    name: "user.delete",
    arguments: JSON.stringify({
      userId: "user_123",
    }),
  },
];

for (const toolCall of proposedToolCalls) {
  const result = await gateOpenAIToolCall(gate, toolCall, {
    target: toolCall.name.split(".")[0],
  });
  queue.set(result.intent.id, {
    intent: result.intent,
    decision: result.decision,
    command: result.command,
    execution: undefined,
  });
}

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", `http://${request.headers.host}`);

  if (request.method === "GET" && url.pathname === "/") {
    return sendHtml(response, renderPage());
  }

  if (request.method === "GET" && url.pathname === "/api/intents") {
    return sendJson(response, [...queue.values()].map(toPublicRecord));
  }

  if (request.method === "POST" && url.pathname.startsWith("/approve/")) {
    const intentId = decodeURIComponent(url.pathname.slice("/approve/".length));
    const record = queue.get(intentId);
    if (!record) return sendJson(response, { error: "Unknown intent." }, 404);
    if (record.decision.outcome !== "requires_approval") {
      return sendJson(response, { error: `Cannot approve ${record.decision.outcome} intent.` }, 400);
    }

    const approved = await gate.approveIntent(record.intent, record.decision, {
      approvedBy: "local_reviewer",
      reason: "Approved in starter app.",
    });
    record.decision = approved;
    record.command = gate.toCommand(record.intent, approved);
    record.execution = fakeExecute(record.command);
    return sendJson(response, toPublicRecord(record));
  }

  return sendJson(response, { error: "Not found." }, 404);
});

server.listen(port, host, () => {
  console.log(`Starter approval app running at http://${host}:${port}`);
});

function fakeExecute(command) {
  return {
    ok: true,
    message: `Fake executor accepted ${command.type}.`,
    received: command,
  };
}

function toPublicRecord(record) {
  return {
    intent: {
      id: record.intent.id,
      type: record.intent.type,
      target: record.intent.target,
      status: record.intent.status,
      args: record.intent.metadata.args,
    },
    decision: record.decision,
    command: record.command,
    execution: record.execution,
  };
}

function renderPage() {
  const rows = [...queue.values()].map((record) => {
    const data = toPublicRecord(record);
    const canApprove = data.decision.outcome === "requires_approval";
    return `<article>
      <header>
        <strong>${escapeHtml(data.intent.type)}</strong>
        <span class="${escapeHtml(data.decision.outcome)}">${escapeHtml(data.decision.outcome)}</span>
      </header>
      <p>${escapeHtml(data.decision.reason ?? "No reason supplied.")}</p>
      <pre>${escapeHtml(JSON.stringify(data.intent.args, null, 2))}</pre>
      ${data.execution ? `<pre>${escapeHtml(JSON.stringify(data.execution, null, 2))}</pre>` : ""}
      ${canApprove ? `<form method="post" action="/approve/${encodeURIComponent(data.intent.id)}"><button>Approve and execute</button></form>` : ""}
    </article>`;
  }).join("");

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>aeg-intent-gate starter</title>
  <style>
    body { margin: 0; background: #f6f8fb; color: #121826; font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    main { max-width: 900px; margin: 0 auto; padding: 32px 20px; }
    h1 { font-size: 34px; margin: 0 0 8px; }
    p { color: #526070; line-height: 1.5; }
    article { background: #fff; border: 1px solid #d9e0ea; border-radius: 8px; margin: 14px 0; padding: 16px; }
    header { align-items: center; display: flex; justify-content: space-between; gap: 12px; }
    span { border-radius: 999px; font-size: 12px; font-weight: 800; padding: 4px 9px; }
    .approved { background: #dcfce7; color: #15803d; }
    .requires_approval { background: #fef3c7; color: #a16207; }
    .blocked { background: #fee2e2; color: #b91c1c; }
    pre { background: #111827; border-radius: 6px; color: #e5e7eb; overflow: auto; padding: 12px; }
    button { background: #0f766e; border: 0; border-radius: 6px; color: #fff; cursor: pointer; font-weight: 800; padding: 10px 14px; }
  </style>
</head>
<body>
  <main>
    <h1>AI tool-call approval starter</h1>
    <p>Raw model tool calls are gated first. Only approved commands reach the fake executor.</p>
    ${rows}
  </main>
</body>
</html>`;
}

function sendHtml(response, body) {
  response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  response.end(body);
}

function sendJson(response, body, status = 200) {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body, null, 2));
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
