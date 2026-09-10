import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";

// Node 22 can expose a partial localStorage object when NODE_OPTIONS carries an
// invalid --localstorage-file path. JSDOM then does not replace it, leaving
// renderer tests without clear()/removeItem(). Keep the test browser contract
// complete without changing production renderer behavior.
if (
  typeof globalThis.localStorage === "undefined" ||
  typeof globalThis.localStorage.clear !== "function"
) {
  const values = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      get length(): number {
        return values.size;
      },
      clear: (): void => {
        values.clear();
      },
      getItem: (key: string): string | null => values.get(key) ?? null,
      key: (index: number): string | null =>
        Array.from(values.keys())[index] ?? null,
      removeItem: (key: string): void => {
        values.delete(key);
      },
      setItem: (key: string, value: string): void => {
        values.set(key, String(value));
      },
    },
  });
}

// Mock react-loader-spinner which fails to load in test environment
vi.mock("react-loader-spinner", () => ({
  Grid: () => null,
  Audio: () => null,
  BallTriangle: () => null,
  Bars: () => null,
  Circles: () => null,
  CirclesWithBar: () => null,
  ColorRing: () => null,
  Comment: () => null,
  Discuss: () => null,
  DNA: () => null,
  FallingLines: () => null,
  FidgetSpinner: () => null,
  Hearts: () => null,
  InfinitySpin: () => null,
  LineWave: () => null,
  MagnifyingGlass: () => null,
  MutatingDots: () => null,
  Oval: () => null,
  ProgressBar: () => null,
  Puff: () => null,
  Radio: () => null,
  RevolvingDot: () => null,
  Rings: () => null,
  RotatingLines: () => null,
  RotatingSquare: () => null,
  RotatingTriangles: () => null,
  TailSpin: () => null,
  ThreeCircles: () => null,
  ThreeDots: () => null,
  Triangle: () => null,
  Vortex: () => null,
  Watch: () => null,
}));

afterEach(() => {
  cleanup();
});
