export const DESKTOP_RELEASE_API =
  "https://api.github.com/repos/pkulyn/agents-one/releases/latest";

/** Query public release metadata only; never fetch installers or update manifests. */
// @lat: [[desktop-updates#Manual GitHub release checks]]
export async function checkLatestDesktopRelease(
  currentVersion: string,
  request: (input: string, init?: RequestInit) => Promise<Response>,
): Promise<string | null> {
  const response = await request(DESKTOP_RELEASE_API, {
    headers: {
      Accept: "application/vnd.github+json",
      "User-Agent": "Agents-One",
    },
    signal: AbortSignal.timeout(15000),
    redirect: "error",
  });
  if (response.status === 404) return null;
  if (!response.ok)
    throw new Error(
      "GitHub update check failed (HTTP " + response.status + ").",
    );
  const release = await response.json();
  if (
    !release ||
    release.draft !== false ||
    release.prerelease !== false ||
    typeof release.tag_name !== "string"
  ) {
    throw new Error("GitHub returned invalid release metadata.");
  }
  const latest = /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(
    release.tag_name,
  );
  const current =
    /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.exec(
      currentVersion,
    );
  if (!latest || !current) throw new Error("Cannot compare release versions.");
  for (let index = 1; index <= 3; index++) {
    const next = BigInt(latest[index]),
      installed = BigInt(current[index]);
    if (next > installed) return latest.slice(1).join(".");
    if (next < installed) return null;
  }
  return current[4] ? latest.slice(1).join(".") : null;
}
