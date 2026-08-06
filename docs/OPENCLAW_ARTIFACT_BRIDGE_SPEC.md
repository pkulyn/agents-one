# OpenClaw Artifact Bridge Contract

This contract lets Agents One provide explicit files and remote project references
to an OpenClaw task without exposing a Windows filesystem path.

## Capability declaration

`GET /capabilities` (or `GET /health`) must advertise:

```json
{
  "capabilities": {
    "artifacts": true,
    "workspaceAccess": true
  }
}
```

`artifacts: true` means the three endpoints below are available. `workspaceAccess`
means the Bridge can consume the approved `workspaceRef` forms described below.

## Upload an input artifact

`POST /artifacts`

Authentication uses the existing `Authorization: Bearer <token>` header. The
request body is JSON so the desktop client can use the same TLS, timeout and
redaction path as task dispatch.

```json
{
  "name": "requirements.pdf",
  "mime": "application/pdf",
  "size": 184320,
  "sha256": "<64 lowercase hex characters>",
  "contentBase64": "...",
  "content_base64": "..."
}
```

Rules:

- Maximum payload before Base64 encoding: 10 MiB per artifact.
- Reject filename traversal, control characters, credential-like filenames and
  checksum/size mismatches with `400` or `422`.
- Store artifacts project/caller scoped, immutable, and with an expiry policy.
- Do not return the content in task logs or error messages.

Success response:

```json
{
  "id": "artifact_01H...",
  "name": "requirements.pdf",
  "mime": "application/pdf",
  "size": 184320,
  "sha256": "<64 lowercase hex characters>"
}
```

## Read an artifact

`GET /artifacts/:id`

Use the same authorization and scope check. Metadata-only responses are allowed
for large artifacts. When content is returned, use `contentBase64` or
`content_base64`; never return a server filesystem path.

## Dispatch a task with inputs

`POST /tasks` accepts the existing prompt/session fields plus:

```json
{
  "artifactIds": ["artifact_01H..."],
  "artifact_ids": ["artifact_01H..."],
  "workspaceRef": "git:https://git.example/team/project.git#main",
  "workspace_ref": "git:https://git.example/team/project.git#main"
}
```

Valid `workspaceRef` values are:

- `artifact:<artifact-id>`: an uploaded project/context bundle.
- `git:<repository-url>#<ref>`: a repository and immutable branch, tag or commit
  reference that the Bridge is authorized to clone.

The Bridge must reject local paths (`C:\...`, `/home/...`, UNC paths) and must
not silently downgrade an invalid workspace reference to unrestricted local
agent execution.

## Task lifecycle and cleanup

- A task response records the accepted artifact ids in its server-side audit
  record but never prints their content.
- Cancellation stops work and releases temporary checkout data. Persistent
  artifacts follow their TTL rather than being deleted before review.
- `404` means an artifact is absent or outside the caller's scope. `409` is
  appropriate when an artifact is not ready. `413` indicates size limits.
