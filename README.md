# aeg-intent-gate-starter

Starter app for gating AI tool calls before they reach real executors.

It shows:

- OpenAI-style function calls
- browser approval queue
- `email.send` requires approval
- `refund.create` requires approval
- `user.delete` is blocked
- approved commands route to a fake executor

## Run

```sh
npm install
npm start
```

Open:

```text
http://localhost:3344
```

## Why This Exists

Do not send raw model tool calls directly to application code. Gate them first, then let executors accept only approved command objects.
