import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { build } from "esbuild";
import { chromium, type Browser, type Page } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const ROOT = resolve(__dirname, "..");
let browser: Browser;
let bundle: string;
let styles: string;

async function mount(page: Page): Promise<void> {
  await page.setContent(
    `<style>html,body{margin:0}${styles}</style><div id="root"></div>`,
  );
  await page.addScriptTag({ content: bundle });
  await page.locator(".splash-hand-human").waitFor();
  await page.evaluate(() =>
    Promise.all([...document.images].map((im) => im.decode())),
  );
}

async function seek(page: Page, time: number): Promise<void> {
  await page.evaluate((ms) => {
    document
      .querySelector(".splash-screen")!
      .getAnimations({ subtree: true })
      .forEach((a) => {
        a.pause();
        a.currentTime = ms;
      });
  }, time);
}

async function geometry(page: Page): Promise<{
  gap: number;
  anchorError: number;
  robotFrameTop: number;
  humanFrameBottom: number;
  windowHeight: number;
  burstOpacity: number;
  logoOpacity: number;
  handFilter: string;
  frame: { width: number; height: number; top: number; bottom: number };
}> {
  return page.evaluate(() => {
    // Measured half-alpha contour points in the actual 1672×941 plate.
    // These are deliberately independent of the component's CSS variables.
    function tip(
      selector: string,
      x: number,
      y: number,
    ): { x: number; y: number } {
      const im = document.querySelector<HTMLImageElement>(selector)!;
      const box = im.getBoundingClientRect();
      return {
        x: box.x + (x * box.width) / 1672,
        y: box.y + (y * box.height) / 941,
      };
    }
    const robot = tip(".splash-hand-robot", 836, 457);
    const human = tip(".splash-hand-human", 858, 478);
    const burst = document
      .querySelector(".splash-contact")!
      .getBoundingClientRect();
    const center = {
      x: burst.x + burst.width / 2,
      y: burst.y + burst.height / 2,
    };
    const frame = document
      .querySelector(".splash-hand-stage")!
      .getBoundingClientRect();
    return {
      gap: Math.hypot(robot.x - human.x, robot.y - human.y),
      anchorError: Math.hypot(robot.x - center.x, robot.y - center.y),
      robotFrameTop: document
        .querySelector(".splash-hand-robot")!
        .getBoundingClientRect().top,
      humanFrameBottom: document
        .querySelector(".splash-hand-human")!
        .getBoundingClientRect().bottom,
      windowHeight: innerHeight,
      burstOpacity: Number(
        getComputedStyle(document.querySelector(".splash-contact")!).opacity,
      ),
      logoOpacity: Number(
        getComputedStyle(document.querySelector(".splash-logo")!).opacity,
      ),
      handFilter: getComputedStyle(
        document.querySelector(".splash-hand-robot")!,
      ).filter,
      frame: {
        width: frame.width,
        height: frame.height,
        top: frame.top,
        bottom: frame.bottom,
      },
    };
  });
}

describe("startup animation in Chromium", () => {
  beforeAll(async () => {
    const css = readFileSync(
      resolve(ROOT, "src/renderer/src/assets/main.css"),
      "utf8",
    );
    styles = css.slice(
      css.indexOf(".splash-screen {"),
      css.indexOf(".error-boundary {"),
    );
    const result = await build({
      stdin: {
        contents:
          'import React from "react"; import {createRoot} from "react-dom/client"; import SplashScreen from "./src/renderer/src/screens/SplashScreen/SplashScreen"; createRoot(document.getElementById("root")).render(<SplashScreen onFinished={()=>{}} status="Loading" />);',
        loader: "tsx",
        resolveDir: ROOT,
      },
      bundle: true,
      write: false,
      format: "iife",
      jsx: "automatic",
      define: { "process.env.NODE_ENV": '"production"' },
      loader: { ".png": "dataurl", ".svg": "dataurl" },
    });
    bundle = result.outputFiles[0].text;
    const systemChrome =
      "C:/Program Files/Google/Chrome/Application/chrome.exe";
    const executablePath =
      process.env.AGENTS_ONE_BROWSER_EXECUTABLE ||
      (process.platform === "win32" && existsSync(systemChrome)
        ? systemChrome
        : undefined);
    browser = await chromium.launch({ headless: true, executablePath });
  }, 30000);

  afterAll(async () => {
    await browser?.close();
  });

  // @lat: [[brand-startup#Startup brand animation#Startup contact geometry regression]]
  it("touches at one image-space anchor before the burst, across window shapes and DPI", async () => {
    for (const size of [
      { width: 1920, height: 1080 },
      { width: 1440, height: 900 },
      { width: 900, height: 900 },
      { width: 800, height: 1100 },
    ]) {
      const page = await browser.newPage({
        viewport: size,
        deviceScaleFactor: size.width === 1440 ? 2 : 1,
      });
      try {
        await mount(page);
        let previousGap = Infinity;
        for (const ms of [0, 500, 1100, 1500, 1650]) {
          await seek(page, ms);
          const g = await geometry(page);
          expect(g.gap).toBeLessThan(previousGap);
          previousGap = g.gap;
          expect(g.burstOpacity).toBe(0);
          expect(g.logoOpacity).toBe(0);
        }
        const final = await geometry(page);
        expect(final.gap).toBeLessThan(0.1);
        expect(final.anchorError).toBeLessThan(0.1);
        expect(final.robotFrameTop).toBeLessThan(final.frame.top);
        expect(final.humanFrameBottom).toBeGreaterThan(final.frame.bottom);
        // A tall window must not enlarge/crop the original wide artwork.
        // This fails the former viewport-cover canvas even with aligned tips.
        expect(final.frame.width).toBeLessThanOrEqual(size.width + 0.1);
        expect(final.frame.height).toBeLessThanOrEqual(size.height + 0.1);
        expect(final.frame.width).toBeCloseTo(
          Math.min(size.width, size.height * (1672 / 941)),
          0,
        );
        expect(final.frame.width / final.frame.height).toBeCloseTo(
          1672 / 941,
          3,
        );
        expect(final.handFilter).toBe("none");
        for (const scale of [1.15, 1.3]) {
          await page.evaluate((value) => {
            document
              .querySelector<HTMLElement>(".splash-screen")!
              .style.setProperty("--splash-hand-scale", String(value));
          }, scale);
          expect((await geometry(page)).gap).toBeLessThan(0.1);
          expect((await geometry(page)).anchorError).toBeLessThan(0.1);
        }
        await seek(page, 1720);
        expect((await geometry(page)).burstOpacity).toBeGreaterThan(0.5);
        expect((await geometry(page)).logoOpacity).toBe(0);
        await seek(page, 2900);
        expect((await geometry(page)).logoOpacity).toBe(1);
        await page.setViewportSize({ width: 1280, height: 720 });
        expect((await geometry(page)).gap).toBeLessThan(0.1);
      } finally {
        await page.close();
      }
    }
  }, 30000);

  // @lat: [[brand-startup#Startup brand animation#Startup foreground integrity regression]]
  it("keeps the silver surfaces opaque and the layer split clear of both rounded fingertips", async () => {
    const page = await browser.newPage();
    try {
      await mount(page);
      const pixels = await page.evaluate(() => {
        const im =
          document.querySelector<HTMLImageElement>(".splash-hand-robot")!;
        const canvas = document.createElement("canvas");
        canvas.width = im.naturalWidth;
        canvas.height = im.naturalHeight;
        const ctx = canvas.getContext("2d")!;
        ctx.drawImage(im, 0, 0);
        const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
        const alpha = (x: number, y: number): number =>
          data[(y * canvas.width + x) * 4 + 3];
        const surfaces = [
          [5, 59],
          [17, 82],
          [50, 65],
          [100, 100],
          [200, 100],
          [300, 150],
          [400, 200],
          [600, 300],
          [810, 440],
        ].map(([x, y]) => alpha(x, y));
        let maxGapAlpha = 0;
        for (let y = 465; y <= 469; y++)
          for (let x = 0; x < canvas.width; x++)
            maxGapAlpha = Math.max(maxGapAlpha, alpha(x, y));
        return {
          width: canvas.width,
          height: canvas.height,
          surfaces,
          maxGapAlpha,
          robotTip: alpha(836, 457),
          humanTip: alpha(858, 478),
        };
      });
      expect([pixels.width, pixels.height]).toEqual([1672, 941]);
      expect(Math.min(...pixels.surfaces)).toBeGreaterThan(245);
      expect(pixels.maxGapAlpha).toBeLessThanOrEqual(8);
      expect(pixels.robotTip).toBeGreaterThanOrEqual(128);
      expect(pixels.humanTip).toBeGreaterThanOrEqual(128);
    } finally {
      await page.close();
    }
  }, 15000);

  // @lat: [[brand-startup#Startup brand animation#Startup reduced motion regression]]
  it("shows the same aligned final scene without a flash when motion is reduced", async () => {
    const page = await browser.newPage({
      viewport: { width: 1280, height: 800 },
      reducedMotion: "reduce",
    });
    try {
      await mount(page);
      const g = await geometry(page);
      expect(g.gap).toBeLessThan(0.1);
      expect(g.logoOpacity).toBe(1);
      expect(await page.locator(".splash-contact").isVisible()).toBe(false);
      expect(await page.locator(".splash-status").textContent()).toBe(
        "Loading",
      );
    } finally {
      await page.close();
    }
  });
});
