# Remote Hermes Smoke Matrix

Date: 2026-07-10

This matrix records the current remote Hermes NAS acceptance result without storing endpoints, tokens, API keys, or response bodies. It is the regression baseline for the multi-agent runtime work.

## Connection Result

| Surface | Probe | Result | Console behavior |
| --- | --- | --- | --- |
| Gateway | `GET /health` | HTTP 200 | Remote legacy chat endpoint is healthy. |
| Dashboard | `GET /api/status` | HTTP 200 | Remote management API is healthy. |
| Sessions | `GET /api/sessions?limit=1` | HTTP 200 | Session list and history may use remote data. |
| Models | `GET /api/model/options` | HTTP 200 | Remote model configuration may use dashboard APIs. |
| Skills | `GET /api/skills` | HTTP 200 | Skills use the shared remote request client. |
| Memory | `GET /api/memory` | HTTP 200 | Memory and user profile APIs are available. |
| MCP | `GET /api/mcp/servers` | HTTP 200 | Remote MCP server management is available. |
| Messaging | `GET /api/messaging/platforms` | HTTP 200 with HTML fallback on the current NAS dashboard | Desktop must treat this as "remote messaging management API unavailable" and render the Gateway catalog read-only instead of throwing an invalid-JSON error. |
| Dashboard chat | WebSocket upgrade at `/api/ws` | Deployment-dependent | If unavailable through the NAS reverse proxy, chat must keep using the legacy remote API fallback. |

## Credential Compatibility

The configured dashboard token was rejected by the current remote management API and WebSocket handshake, while the configured gateway API key was accepted on the same origin. Agents One now applies this policy:

1. Use the dashboard token as the primary credential.
2. Retry only HTTP 401/403 and WebSocket authentication failures with the gateway API key.
3. Permit that fallback only when dashboard and gateway have the identical URL origin.
4. Keep the successful credential only in the in-memory connection object so the renderer WebSocket uses the working token; do not overwrite saved settings.

## Regression Evidence

- Targeted remote tests: 5 files, 46 tests passed (Dashboard transport, authentication fallback, remote sessions/cache shape, remote skills, Gateway HTML degradation, and remote certificate policy).
- TypeScript typecheck passed.
- Production build passed.
- Live NAS probes passed for all entries above.
- 2026-07-11 follow-up: the Gateway messaging management endpoint can return the dashboard HTML app shell instead of JSON on the current remote deployment. Agents One now classifies that response as an unsupported remote management API and keeps the Gateway page read-only.

## Remaining Limits

- This is a point-in-time live probe, not a permanent availability guarantee.
- Automatic runtime selection and task dispatch are not part of the Hermes baseline; they begin in P1.
- The repository-wide `lat check` remains blocked by pre-existing knowledge-graph links outside this change set.
