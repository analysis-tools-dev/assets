/*
 * Takes a screenshot from a website
 * Alternatives considered:
 * - https://www.screenshotapi.io/ - Simple API, not free but cheap. Maybe alternative for the future.
 * - https://github.com/brenden/node-webshot - Very popular, but seems to have a lot of issues.
 */

import fs from "fs";
import dotenv from "dotenv";
import ImageKit from "imagekit";
import fetch from "node-fetch";
import { Logger } from "tslog";

import { ApiTool, ScreenshotJson, ToolsApiData } from "./types";
import { takeScreenshot } from "./screenshot";
import { PublicationMetadata, refreshTool } from "./publication";

// Check command line flags
const dryRun = process.argv.includes("--dry-run");
const forceUpdate = process.argv.includes("--force");

dotenv.config();

const logger = new Logger();

// Log active flags
if (dryRun) {
  logger.info(
    "[DRY-RUN] Running in dry-run mode - no captures, uploads, or files will be changed",
  );
}
if (forceUpdate) {
  logger.info("[FORCE] Force mode enabled - all screenshots will be regenerated");
}

// Ensure required environment variables are set
if (
  !dryRun &&
  (!process.env.IMAGEKIT_PUBLIC_KEY || !process.env.IMAGEKIT_PRIVATE_KEY)
) {
  logger.error(
    "Please set the IMAGEKIT_PUBLIC_KEY and IMAGEKIT_PRIVATE_KEY environment variables.",
  );
  process.exit(1);
}

const imageKit = dryRun
  ? null
  : new ImageKit({
      publicKey: process.env.IMAGEKIT_PUBLIC_KEY!,
      privateKey: process.env.IMAGEKIT_PRIVATE_KEY!,
      urlEndpoint: "https://ik.imagekit.io/analysistools",
    });

const SCREENSHOTS_JSON_PATH = "screenshots.json";

const METADATA_PATH = "screenshots.metadata.json";

const STATIC_TOOLS_JSON_FILE =
  "https://raw.githubusercontent.com/analysis-tools-dev/static-analysis/master/data/api/tools.json";

const DYNAMIC_TOOLS_JSON_FILE =
  "https://raw.githubusercontent.com/analysis-tools-dev/dynamic-analysis/master/data/api/tools.json";

// Fetch all screenshot URLs for the given tool
const loadUrlsForTool = (tool: ApiTool): string[] => {
  const urls = [tool.homepage];
  if (tool.source && tool.source !== tool.homepage) {
    urls.push(tool.source);
  }
  tool.resources?.forEach((resource) => {
    // if the resource is a PDF, we don't want to take a screenshot
    if (resource.url.endsWith(".pdf")) {
      return;
    }

    urls.push(resource.url);
  });
  if (tool.pricing != null) {
    urls.push(tool.pricing);
  }
  return urls;
};

// Get tools from static and dynamic analysis repos
const downloadToolsApiData = async (): Promise<ToolsApiData> => {
  const staticResponse = await fetch(STATIC_TOOLS_JSON_FILE);
  const staticTools = (await staticResponse.json()) as ToolsApiData;

  const dynamicResponse = await fetch(DYNAMIC_TOOLS_JSON_FILE);
  const dynamicTools = (await dynamicResponse.json()) as ToolsApiData;

  // Merge static and dynamic tools
  return { ...staticTools, ...dynamicTools };
};

// Upload screenshot to ImageKit
//
// Returns the URL of the uploaded image, or null if the upload failed
const uploadScreenshotToImageKit = async (
  screenshotPath: string,
  fileName: string,
): Promise<string | null> => {
  try {
    logger.info(`[PUSH] Uploading ${screenshotPath} with name ${fileName}`);

    if (!imageKit) {
      logger.info("[DRY-RUN] Skipping upload");
      return null;
    }

    const response = await imageKit.upload({
      file: fs.readFileSync(screenshotPath), // Directly pass the file buffer
      fileName,
      // Overwrite existing files and use the original filename
      useUniqueFileName: false,
    });
    logger.info(`[PUSH] ${response.url} uploaded successfully!`);
    return response.url;
  } catch (error) {
    logger.error(`[FAIL] Error uploading ${screenshotPath}:`, error);
    return null;
  }
};

// Read persisted publication state; checkout times and local image files are irrelevant.
const screenshots: ScreenshotJson = fs.existsSync(SCREENSHOTS_JSON_PATH)
  ? JSON.parse(fs.readFileSync(SCREENSHOTS_JSON_PATH, "utf-8"))
  : {};
const metadata: PublicationMetadata = fs.existsSync(METADATA_PATH)
  ? JSON.parse(fs.readFileSync(METADATA_PATH, "utf-8"))
  : {};

const tools = await downloadToolsApiData();
let captureFailures = 0;
let uploadFailures = 0;
for (const tool of Object.keys(tools)) {
  const failures = await refreshTool(
    tool,
    loadUrlsForTool(tools[tool]),
    screenshots,
    metadata,
    {
      dryRun,
      force: forceUpdate,
      capture: async (url, path) => {
        fs.mkdirSync(`screenshots/${tool}`, { recursive: true });
        return takeScreenshot(url, path);
      },
      upload: uploadScreenshotToImageKit,
      now: Date.now,
      log: (message, error) => {
        if (error) logger.error(message, error);
        else logger.info(message);
      },
    },
  );
  captureFailures += failures.captureFailures;
  uploadFailures += failures.uploadFailures;
}

if (!dryRun) {
  // Save the manifest first: metadata must never certify an unpublished mapping.
  fs.writeFileSync(SCREENSHOTS_JSON_PATH, JSON.stringify(screenshots, null, 2));
  fs.writeFileSync(METADATA_PATH, JSON.stringify(metadata, null, 2));
}
if (captureFailures || uploadFailures) {
  logger.error(
    `[FAIL] ${captureFailures} capture failure(s), ${uploadFailures} upload failure(s). Successful progress saved.`,
  );
  process.exitCode = 1;
} else {
  logger.info(
    dryRun
      ? "[DONE] Dry-run complete; no files changed."
      : "[DONE] All screenshots taken and uploaded!",
  );
}
