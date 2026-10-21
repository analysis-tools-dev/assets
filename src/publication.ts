import { PathMapping, ScreenshotJson } from "./types";

export type PublicationMetadata = Record<
  string,
  Record<string, { path: string; capturedAt: number; publishedAt: number }>
>;

export const MAX_AGE = 5 * 24 * 60 * 60 * 1000;

export function isFresh(
  mapping: PathMapping | undefined,
  metadata: PublicationMetadata[string][string] | undefined,
  now: number,
): boolean {
  return !!(
    mapping?.path &&
    metadata &&
    metadata.path === mapping.path &&
    Number.isFinite(metadata.capturedAt) &&
    Number.isFinite(metadata.publishedAt) &&
    metadata.capturedAt <= metadata.publishedAt &&
    metadata.publishedAt <= now &&
    now - metadata.capturedAt < MAX_AGE
  );
}

// Dependencies are injected so retries and partial failures can be tested offline.
export async function refreshTool(
  tool: string,
  urls: string[],
  screenshots: ScreenshotJson,
  metadata: PublicationMetadata,
  options: {
    dryRun: boolean;
    force: boolean;
    capture: (url: string, path: string) => Promise<boolean>;
    upload: (path: string, url: string) => Promise<string | null>;
    now: () => number;
    log: (message: string, error?: unknown) => void;
  },
): Promise<{ captureFailures: number; uploadFailures: number }> {
  const failures = { captureFailures: 0, uploadFailures: 0 };
  for (const url of new Set(urls)) {
    const existing = screenshots[tool]?.find((entry) => entry.url === url);
    if (!options.force && isFresh(existing, metadata[tool]?.[url], options.now())) {
      options.log(`[SKIP] ${url}`);
      continue;
    }
    const path = `screenshots/${tool}/${encodeURIComponent(url)}.jpg`;
    if (options.dryRun) {
      options.log(`[DRY-RUN] Would capture and upload ${url}`);
      continue;
    }

    // Even a forced refresh that fails must be retried, not hidden by old metadata.
    if (metadata[tool]) delete metadata[tool][url];
    let capturedAt: number;
    try {
      options.log(`[LOAD] ${url} (${path})`);
      if (!(await options.capture(url, path))) throw new Error("Capture returned false");
      capturedAt = options.now();
    } catch (error) {
      failures.captureFailures++;
      options.log(`[FAIL] Error taking screenshot for ${url}`, error);
      continue;
    }

    try {
      const publishedPath = await options.upload(path, url);
      if (!publishedPath) throw new Error("Upload returned no URL");
      const mapping = { url, path: publishedPath };
      const entries = screenshots[tool] ?? [];
      screenshots[tool] = [...entries.filter((entry) => entry.url !== url), mapping];
      metadata[tool] ??= {};
      metadata[tool][url] = {
        path: publishedPath,
        capturedAt,
        publishedAt: options.now(),
      };
    } catch (error) {
      failures.uploadFailures++;
      options.log(`[FAIL] Error uploading ${url}`, error);
    }
  }
  return failures;
}
