# Security Policy

## Supported versions

Agents One is currently a pre-1.0 project. Security fixes are provided only for the latest published release and the current `main` branch. Older builds and unmerged forks are not supported. Until the first public release exists, `main` is the only supported line.

## Report a vulnerability privately

Do not open a public issue, discussion, pull request, or social-media post for a suspected vulnerability or include credentials, private logs, or exploit details there.

Use GitHub's private vulnerability reporting form:

<https://github.com/pkulyn/agents-one/security/advisories/new>

The public repository and its private-reporting feature must be enabled before the first release. If that form is unavailable, wait for the private channel to be restored; ordinary Issues are not an acceptable fallback for sensitive reports.

Please include the affected version/commit, operating system, impact, minimal reproduction, and whether the report contains real user data. Replace all real credentials with test values.

## Response targets

- Acknowledgement: within 3 business days.
- Initial severity and scope assessment: within 7 business days.
- Status update or remediation plan for accepted reports: within 14 business days.
- Coordinated disclosure: after a fix is available, or on a mutually agreed date. Critical actively exploited issues may require an accelerated release.

These are response targets, not a bug-bounty promise. The maintainer will credit reporters who request credit and will keep reporter identity private unless disclosure is authorized or legally required.

## Threat model and trust boundaries

### Desktop and Runtime processes

The Electron main process, preload bridge, renderer, local CLI runtimes, and separately installed third-party runtimes do not share the same trust level. Renderer input is untrusted at IPC boundaries. A Runtime may execute tools with the workspace permission selected by the user; Agents One does not turn a full-access Runtime into a sandbox. Runtime output, tool arguments, model content, and imported artifacts must be treated as untrusted data.

Desktop-managed Remote Gateway tokens are stored in an Electron `safeStorage` encrypted file when an OS-backed provider is available. Windows protection is bound to the current user and normally the current machine. A copied or damaged ciphertext is reported as unreadable and requires reauthorization. On Linux, Electron's `basic_text` backend is not considered secure storage; Agents One warns and retains the legacy restricted-file path. General provider/API secrets can remain in `.env`, process environment variables, or an external command provider and are outside the desktop protected store.

### Gateway and Connector

Remote Gateway endpoints are network trust boundaries. Tokens authenticate a specific endpoint/runtime and must not be placed in URLs, logs, artifacts, or exported configuration. TLS authenticates the endpoint; users are responsible for the remote service and its data handling.

Agents One Connector runs separately from the desktop. On Windows, its device token, device private key, and pending-pairing secrets are protected with current-user DPAPI. Moving these blobs to a different user or machine normally makes them unreadable and requires pairing again. On macOS/Linux, Connector storage relies on user-only directory/file permissions; full-disk compromise or code running as the same user remains in scope for the operating system, not prevented by file permissions alone.

### WebView and external content

Web Agent pages and previews contain untrusted remote content. Navigation allowlists, hardened web preferences, isolated sessions, permission denial, and the preload IPC allowlist are security controls. Logging in to a third-party site grants that site the data and permissions visible in its isolated session. Agents One does not bypass third-party access controls, CAPTCHAs, subscriptions, or terms of service.

### Updates and build artifacts

Release workflows, signing identities, update metadata, and repository permissions are part of the software supply-chain boundary. Users should install only artifacts attached to the official repository release and verify published hashes/signatures when available. An unsigned development build has no publisher identity guarantee. Pull-request CI artifacts are not releases.

### Backup, restore, diagnostics, and export

Backups use an allowlist and exclude `.env`, account/credential files, API keys, tokens, raw configuration, protected-secret blobs, Connector credentials, and machine-specific secret references. Restores retain target-machine credentials and use a rollback journal. Diagnostics and logs are redacted, but users must still review any file before sharing it; arbitrary Runtime/model output can contain data that automatic redaction does not recognize.

## Out of scope

- Attacks that already execute arbitrary code as the same OS user, unless they cross an additional documented Agents One boundary.
- Vulnerabilities in a third-party Runtime or remote service that do not arise from Agents One integration.
- Social engineering, denial of service requiring sustained local access, and reports containing only missing hardening without a security impact.
- Secrets deliberately pasted into conversations, tool output, arbitrary artifacts, or third-party websites.

Out-of-scope reports may still lead to hardening changes, but they are not treated as Agents One vulnerabilities by default.
