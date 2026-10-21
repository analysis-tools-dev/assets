import fs from "fs";
import os from "os";
import path from "path";
import { isFresh, MAX_AGE, PublicationMetadata, refreshTool } from "./publication";
import { ScreenshotJson } from "./types";

const now = 1_800_000_000_000;
const url = "https://example.com";
const oldMapping = { url, path: "https://cdn.example/old.jpg" };
const record = { path: oldMapping.path, capturedAt: now - 1000, publishedAt: now - 500 };

function setup() {
  const screenshots: ScreenshotJson = { tool: [{ ...oldMapping }] };
  const metadata: PublicationMetadata = {};
  const options = {
    dryRun: false,
    force: false,
    capture: jest.fn(async () => true),
    upload: jest.fn(async (): Promise<string | null> => "https://cdn.example/new.jpg"),
    now: () => now,
    log: jest.fn(),
  };
  return { screenshots, metadata, options };
}

describe("publication freshness", () => {
  test("checkout mtimes cannot make stale or legacy screenshots fresh", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "publication-"));
    const file = path.join(dir, "image.jpg");
    try {
      fs.writeFileSync(file, "image");
      for (const timestamp of [new Date(0), new Date(now)]) {
        fs.utimesSync(file, timestamp, timestamp);
        expect(isFresh(oldMapping, undefined, now)).toBe(false);
        expect(isFresh(oldMapping, { ...record, capturedAt: now - MAX_AGE }, now)).toBe(false);
        expect(isFresh(oldMapping, record, now)).toBe(true);
      }
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test("requires a matching mapping and valid capture/publication timestamps", () => {
    expect(isFresh(undefined, record, now)).toBe(false);
    expect(isFresh({ ...oldMapping, path: "other" }, record, now)).toBe(false);
    for (const invalid of [
      { ...record, capturedAt: NaN },
      { ...record, publishedAt: undefined },
      { ...record, publishedAt: now + 1 },
      { ...record, capturedAt: now },
    ]) {
      expect(isFresh(oldMapping, invalid as typeof record, now)).toBe(false);
    }
  });

  test("skips a successful publication without consulting a local file", async () => {
    const { screenshots, metadata, options } = setup();
    metadata.tool = { [url]: record };
    expect(await refreshTool("tool", [url], screenshots, metadata, options))
      .toEqual({ captureFailures: 0, uploadFailures: 0 });
    expect(options.capture).not.toHaveBeenCalled();
    expect(options.upload).not.toHaveBeenCalled();
  });

  test("publishes legacy mappings and records metadata only after upload", async () => {
    const { screenshots, metadata, options } = setup();
    options.upload.mockImplementation(async () => {
      expect(metadata.tool?.[url]).toBeUndefined();
      expect(screenshots.tool).toEqual([oldMapping]);
      return "https://cdn.example/new.jpg";
    });
    await refreshTool("tool", [url, url], screenshots, metadata, options);
    expect(options.capture).toHaveBeenCalledTimes(1);
    expect(metadata.tool[url]).toEqual({
      path: "https://cdn.example/new.jpg", capturedAt: now, publishedAt: now,
    });
    expect(isFresh(screenshots.tool[0], metadata.tool[url], now)).toBe(true);
  });

  test.each(["false", "throw"])("counts capture failure (%s) and preserves old mapping", async (mode) => {
    const { screenshots, metadata, options } = setup();
    metadata.tool = { [url]: record };
    options.force = true;
    options.capture.mockImplementation(async () => {
      if (mode === "throw") throw new Error("capture failed");
      return false;
    });
    expect(await refreshTool("tool", [url], screenshots, metadata, options))
      .toEqual({ captureFailures: 1, uploadFailures: 0 });
    expect(options.upload).not.toHaveBeenCalled();
    expect(screenshots.tool).toEqual([oldMapping]);
    expect(metadata.tool[url]).toBeUndefined();
  });

  test.each(["null", "throw"])("retries failed upload (%s), even after a fresh forced capture", async (mode) => {
    const { screenshots, metadata, options } = setup();
    metadata.tool = { [url]: record };
    options.force = true;
    options.upload.mockImplementationOnce(async () => {
      if (mode === "throw") throw new Error("upload failed");
      return null;
    });
    expect(await refreshTool("tool", [url], screenshots, metadata, options))
      .toEqual({ captureFailures: 0, uploadFailures: 1 });
    expect(screenshots.tool).toEqual([oldMapping]);
    expect(metadata.tool[url]).toBeUndefined();
    options.force = false;
    // Simulate the next checkout loading persisted state, with the captured file still present.
    await refreshTool("tool", [url], JSON.parse(JSON.stringify(screenshots)),
      JSON.parse(JSON.stringify(metadata)), options);
    expect(options.capture).toHaveBeenCalledTimes(2);
    expect(options.upload).toHaveBeenCalledTimes(2);
  });

  test("keeps successful partial progress while counting both failure types", async () => {
    const { screenshots, metadata, options } = setup();
    const urls = [url, "https://capture-fails.example", "https://upload-fails.example"];
    screenshots.tool.push({ url: urls[2], path: "old-upload" });
    options.capture.mockResolvedValueOnce(true).mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    options.upload.mockResolvedValueOnce("new").mockResolvedValueOnce(null);
    expect(await refreshTool("tool", urls, screenshots, metadata, options))
      .toEqual({ captureFailures: 1, uploadFailures: 1 });
    expect(JSON.parse(JSON.stringify(screenshots))).toEqual({ tool: [
      { url: urls[2], path: "old-upload" }, { url, path: "new" },
    ] });
    expect(Object.keys(metadata.tool)).toEqual([url]);
  });

  test.each([false, true])("dry run leaves all state untouched (force=%s)", async (force) => {
    const { screenshots, metadata, options } = setup();
    metadata.tool = { [url]: record };
    const before = JSON.stringify({ screenshots, metadata });
    options.dryRun = true;
    options.force = force;
    expect(await refreshTool("tool", [url, "https://new.example"], screenshots, metadata, options))
      .toEqual({ captureFailures: 0, uploadFailures: 0 });
    expect(JSON.stringify({ screenshots, metadata })).toBe(before);
    expect(options.capture).not.toHaveBeenCalled();
    expect(options.upload).not.toHaveBeenCalled();
  });
});
