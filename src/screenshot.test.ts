jest.mock("capture-website", () => ({
  __esModule: true,
  default: { file: jest.fn() },
}));

jest.mock("node-fetch", () => ({
  __esModule: true,
  default: jest.fn(),
}));

jest.mock("bottleneck", () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({
    wrap: (fn: unknown) => fn,
  })),
}));

import captureWebsite from "capture-website";
import fs from "fs";
import fetch, { type Response } from "node-fetch";
import { PassThrough, Readable, Writable } from "node:stream";
import { takeScreenshot } from "./screenshot";

const url = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";
const outPath = "thumbnail.jpg";
const mockedFetch = jest.mocked(fetch);

function respond(status: number, body: Readable | null) {
  mockedFetch.mockResolvedValueOnce({
    status,
    ok: status >= 200 && status < 300,
    body,
  } as Response);
}

describe("YouTube thumbnail downloads", () => {
  let createWriteStream: jest.SpyInstance;

  beforeEach(() => {
    mockedFetch.mockReset();
    jest.mocked(captureWebsite.file).mockClear();
    createWriteStream = jest.spyOn(fs, "createWriteStream");
    jest.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("waits for the destination to finish before reporting success", async () => {
    let finish!: () => void;
    let finalStarted!: () => void;
    const finalizing = new Promise<void>((resolve) => {
      finalStarted = resolve;
    });
    const chunks: Buffer[] = [];
    const destination = new Writable({
      write(chunk, _encoding, callback) {
        chunks.push(chunk);
        callback();
      },
      final(callback) {
        finish = callback;
        finalStarted();
      },
    });
    createWriteStream.mockReturnValue(destination);
    respond(200, Readable.from([Buffer.from("thumbnail")]));

    let settled = false;
    const result = takeScreenshot(url, outPath).then((success) => {
      settled = true;
      return success;
    });
    await finalizing;
    await Promise.resolve();
    const settledBeforeFinish = settled;
    finish();

    await expect(result).resolves.toBe(true);
    expect(settledBeforeFinish).toBe(false);
    expect(destination.writableFinished).toBe(true);
    expect(Buffer.concat(chunks).toString()).toBe("thumbnail");
    expect(createWriteStream).toHaveBeenCalledWith(outPath);
    expect(captureWebsite.file).not.toHaveBeenCalled();
  });

  test.each(["source", "destination"])("returns false on a %s stream error", async (side) => {
    const error = new Error(`${side} failed`);
    const source = side === "source"
      ? new Readable({ read() { this.destroy(error); } })
      : Readable.from([Buffer.from("thumbnail")]);
    const destination = new Writable({
      write(_chunk, _encoding, callback) {
        callback(side === "destination" ? error : undefined);
      },
    });
    createWriteStream.mockReturnValue(destination);
    respond(200, source);

    await expect(takeScreenshot(url, outPath)).resolves.toBe(false);
    expect(console.error).toHaveBeenCalledWith(`Failed to take screenshot of ${url}:`, error);
    expect(captureWebsite.file).not.toHaveBeenCalled();
  });

  test.each([403, 500])("rejects HTTP %s without writing or capturing", async (status) => {
    respond(status, Readable.from(["error page"]));

    await expect(takeScreenshot(url, outPath)).resolves.toBe(false);
    expect(createWriteStream).not.toHaveBeenCalled();
    expect(captureWebsite.file).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalled();
  });

  test("returns false for a successful response without a body", async () => {
    respond(200, null);

    await expect(takeScreenshot(url, outPath)).resolves.toBe(false);
    expect(createWriteStream).not.toHaveBeenCalled();
    expect(captureWebsite.file).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalled();
  });

  test.each([200, 404])("handles the 404 fallback returning HTTP %s", async (status) => {
    respond(404, Readable.from([]));
    respond(status, Readable.from(["fallback thumbnail"]));
    createWriteStream.mockReturnValue(new PassThrough());

    await expect(takeScreenshot(url, outPath)).resolves.toBe(status === 200);
    expect(mockedFetch).toHaveBeenNthCalledWith(1, "http://img.youtube.com/vi/dQw4w9WgXcQ/maxresdefault.jpg");
    expect(mockedFetch).toHaveBeenNthCalledWith(2, "http://img.youtube.com/vi/dQw4w9WgXcQ/hqdefault.jpg");
    expect(createWriteStream).toHaveBeenCalledTimes(status === 200 ? 1 : 0);
    expect(captureWebsite.file).not.toHaveBeenCalled();
  });
});
