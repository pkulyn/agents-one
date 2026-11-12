import { EventEmitter } from "node:events";
import { Readable } from "node:stream";
import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ lookup: vi.fn(), request: vi.fn() }));
vi.mock("node:dns/promises", () => ({ lookup: mocks.lookup }));
vi.mock("node:https", () => ({ request: mocks.request }));
vi.mock("node:http", () => ({ request: mocks.request }));
import {
  createOneWebTools,
  isPublicWebAddress,
  readPublicWeb,
} from "./web-tools";
const signal = (): AbortSignal => new AbortController().signal;
beforeEach(() => {
  vi.clearAllMocks();
  mocks.lookup.mockResolvedValue([{ address: "8.8.8.8", family: 4 }]);
});
it.each([
  "127.0.0.1",
  "10.0.0.1",
  "0.0.0.0",
  "169.254.169.254",
  "100.64.0.1",
  "192.168.0.1",
  "::1",
  "::ffff:8.8.8.8",
  "fc00::1",
  "fe80::1",
  "2001:db8::1",
  "224.0.0.1",
])("rejects non-public address %s", (address) => {
  expect(isPublicWebAddress(address)).toBe(false);
});
it("accepts public IPv4 and IPv6", () => {
  expect(isPublicWebAddress("8.8.8.8")).toBe(true);
  expect(isPublicWebAddress("2606:4700:4700::1111")).toBe(true);
});
function response(
  body: string,
  status = 200,
  headers: Record<string, string> = {},
): void {
  mocks.request.mockImplementationOnce((_url, options, callback) => {
    const req = new EventEmitter() as EventEmitter & { end: () => void };
    req.end = () => {
      options.lookup("host", {}, (_error: unknown, address: string) =>
        expect(address).toBe("8.8.8.8"),
      );
      const res = Readable.from([Buffer.from(body)]);
      Object.assign(res, {
        statusCode: status,
        headers: { "content-type": "text/html", ...headers },
      });
      callback(res);
    };
    return req;
  });
}
it("pins DNS and rechecks redirects before connecting", async () => {
  response("", 302, { location: "http://127.0.0.1/metadata" });
  await expect(readPublicWeb("https://example.com", signal())).rejects.toThrow(
    "private",
  );
  expect(mocks.request).toHaveBeenCalledTimes(1);
});
it("rejects mixed public/private DNS answers and credential URLs", async () => {
  mocks.lookup.mockResolvedValue([
    { address: "8.8.8.8", family: 4 },
    { address: "10.0.0.1", family: 4 },
  ]);
  await expect(readPublicWeb("https://example.com", signal())).rejects.toThrow(
    "private",
  );
  await expect(
    readPublicWeb("https://user:secret@example.com", signal()),
  ).rejects.toThrow("credentials");
  expect(mocks.request).not.toHaveBeenCalled();
});
it("bounds actual response bytes and surfaces provider errors", async () => {
  response("x".repeat(2 * 1024 * 1024 + 1));
  await expect(readPublicWeb("https://example.com", signal())).rejects.toThrow(
    "2 MiB",
  );
  response("", 503);
  await expect(readPublicWeb("https://example.com", signal())).rejects.toThrow(
    "503",
  );
});
it("supports cancellable public reads and rejects non-text content", async () => {
  const controller = new AbortController();
  controller.abort();
  await expect(
    readPublicWeb("https://example.com", controller.signal),
  ).rejects.toThrow();
  response("abc", 200, { "content-type": "image/png" });
  await expect(readPublicWeb("https://example.com", signal())).rejects.toThrow(
    "text document",
  );
});
it("returns attributable search results and treats captcha/service failures as errors", async () => {
  const read = vi.fn().mockResolvedValue({
    url: "https://www.bing.com/search",
    contentType: "application/rss+xml",
    body: "<rss><channel><item><title>AI &amp; research</title><link>https://example.com/news</link><description>New result</description><pubDate>Thu, 12 Nov 2026</pubDate></item></channel></rss>",
  });
  const web = createOneWebTools(read);
  const found = JSON.parse(
    await web.executeTool("web_search", { query: "AI news" }, signal()),
  );
  expect(found.results).toEqual([
    {
      title: "AI & research",
      url: "https://example.com/news",
      snippet: "New result",
      publishedAt: "Thu, 12 Nov 2026",
    },
  ]);
  expect(read.mock.calls[0][0]).toContain("q=AI%20news");
  read.mockResolvedValueOnce({ body: "<html>captcha</html>" });
  await expect(
    web.executeTool("web_search", { query: "news" }, signal()),
  ).rejects.toThrow("no search results were verified");
});
it("looks up weather using resolved coordinates, returns dates and units, and does not write files", async () => {
  const read = vi
    .fn()
    .mockResolvedValueOnce({
      body: JSON.stringify({
        results: [
          {
            name: "Guangzhou",
            latitude: 23.13,
            longitude: 113.26,
            country: "China",
          },
        ],
      }),
    })
    .mockResolvedValueOnce({
      body: JSON.stringify({
        timezone: "Asia/Shanghai",
        daily_units: { temperature_2m_max: "°C" },
        daily: { time: ["2026-11-12"], temperature_2m_max: [25] },
      }),
    });
  const web = createOneWebTools(read);
  const forecast = JSON.parse(
    await web.executeTool(
      "weather_forecast",
      { location: "Guangzhou", days: 14 },
      signal(),
    ),
  );
  expect(read.mock.calls[1][0]).toContain("latitude=23.13&longitude=113.26");
  expect(forecast.daily.time).toEqual(["2026-11-12"]);
  expect(forecast.location.name).toBe("Guangzhou");
  expect(forecast.units.temperature_2m_max).toBe("°C");
  expect(web.tools.map((t) => t.name)).toEqual([
    "web_search",
    "web_fetch",
    "weather_forecast",
  ]);
});
it("sanitizes fetched HTML and bounds model-visible text", async () => {
  const web = createOneWebTools(async () => ({
    url: "https://example.com",
    contentType: "text/html",
    body: "<script>bad()</script><p>" + "x".repeat(31000) + "</p>",
  }));
  const result = JSON.parse(
    await web.executeTool(
      "web_fetch",
      { url: "https://example.com" },
      signal(),
    ),
  );
  expect(result.content).toHaveLength(30000);
  expect(result.truncated).toBe(true);
  expect(result.content).not.toContain("bad()");
});
