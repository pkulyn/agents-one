export function printStatus(status) {
  console.log(JSON.stringify(status, null, 2));
}

export async function diagnoseConnect(endpoint, fetchImpl = globalThis.fetch) {
  if (!endpoint) throw new Error("--connect is required.");
  const url = new URL(endpoint);
  const probe = new URL(
    "connect/v1/health",
    `${url.toString().replace(/\/+$/, "")}/`,
  );
  const response = await fetchImpl(probe);
  console.log(
    JSON.stringify(
      {
        endpoint: url.toString().replace(/\/$/, ""),
        status: response.status,
        reachable: response.ok,
      },
      null,
      2,
    ),
  );
}
