# Hers Agents One Plugin Installation

This guide installs the Agents One Plugin SDK on Hers's Relay host. It does
not include a Gateway Token, API key, or any office-computer path.

## What the plugin changes

The plugin is a small Gateway host and event-normalization layer. Hers keeps
its existing native Hermes/Relay behavior, but exposes a standard Agents One
Remote Gateway v1 surface:

- one public Gateway address;
- one Bearer Gateway Token;
- a stable `conversationId` for continued conversations;
- Agent Event Stream v1 events for reasoning summaries, tools, skills, MCP,
  workspace operations, artifacts, and final answers;
- Workspace Grant operations remain initiated by Hers and executed only by
  the Agents One desktop client.

Installing the package alone is not enough. Hers must wire its native event
source into the adapter shown in `examples/hermes-or-hers-adapter.mjs` and run
that adapter as the Relay-facing service.

## Install on Hers

1. Copy `agents-one-plugin-sdk-0.1.0.tgz` to the Hers Relay host through an
   existing secure channel. Do not place any Token in the archive name or a
   shared chat transcript.
2. Use a user-level Node.js 20 or newer installation and run:

   ```powershell
   npm install ./agents-one-plugin-sdk-0.1.0.tgz
   npx agents-one-plugin-verify
   ```

3. Copy the Hers example into the Relay project, map the native run lifecycle
   and events, and start it with a Gateway Token provided through the Relay's
   existing protected environment-variable mechanism.
4. Keep the existing HTTPS/Relay route, but point it to the plugin host under
   the desired public base path, for example `https://relay.example/agents-one/v1`.

## Required capability response

`GET /capabilities` must be authenticated and include this plugin identity at
the response root. Agents One uses it only for connection-test display; it does
not save it as runtime configuration.

```json
{
  "protocolVersion": "1.0",
  "plugin": {
    "id": "agents-one-plugin-sdk",
    "version": "0.1.0",
    "kind": "remote-gateway"
  },
  "capabilities": {
    "conversation": { "stream": "sse", "continuation": true },
    "tasks": { "start": true, "get": true, "cancel": true },
    "eventStream": {
      "protocol": "agents-one-event-stream-v1",
      "transport": "poll",
      "reasoningSummaries": true,
      "toolEvents": true,
      "modelMetadata": true,
      "usageMetadata": true
    }
  }
}
```

Use `transport: "sse"` or `"websocket"` only when that endpoint is genuinely
available. A polling event snapshot is valid during the first rollout.

## Validate with Agents One

In **Agents One -> Intelligent agents -> New agent**:

1. Select Remote, then Gateway v1.
2. Fill only the public Gateway address and Gateway Token.
3. Click **Connection test**.
4. The result must show `Unified Gateway v1 connected`, `Agents One plugin
   recognized v0.1.0`, and the declared detailed event capabilities.
5. Save the agent, start a new task conversation, and verify that its task
   record is created under Hers rather than another Hermes agent.

For a real workspace test, select a project folder and grant read or full
access from Agents One. Deletion still requires a separate local confirmation
for every request.

## Acceptance checklist

- `/capabilities`, `/runs`, `/runs/{id}`, and cancel all require Bearer auth.
- One continued task reuses its `conversationId` and displays the correct
  configured Hers name/avatar in Agents One.
- At least one `reasoning.summary`, one tool event, and one final-answer event
  reach the desktop without raw chain-of-thought, tokens, absolute paths, or
  complete sensitive file contents.
- For Workspace Grant, test list/read/write first; a delete request must cause
  an explicit confirmation on the desktop and never execute silently.

## Troubleshooting

- **Plugin not recognized:** check that `plugin` is at the top level of
  `/capabilities`, not nested under `capabilities`, and that the Relay proxy
  forwards the plugin host response unchanged.
- **Connected but no detailed events:** check `/runs/{id}` for the bounded
  `events` array and compare each event with `AGENT_EVENT_STREAM_V1.md`.
- **A task opens the wrong agent:** verify the runtime ID returned by the
  Gateway and the `conversationId` returned by `POST /runs`; do not reuse a
  different agent's ID.
- **Workspace action unavailable:** confirm that the run received the current
  `workspaceRef`; never substitute an office-computer absolute path.
