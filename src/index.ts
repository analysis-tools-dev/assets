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

import { ApiTool, PathMapping, ScreenshotJson, ToolsApiData } from "./types";
import { takeScreenshot } from "./screenshot";

dotenv.config();

const logger = new Logger();

// Ensure required environment variables are set
if (!process.env.IMAGEKIT_PUBLIC_KEY || !process.env.IMAGEKIT_PRIVATE_KEY) {
  logger.error(
    "Please set the IMAGEKIT_PUBLIC_KEY and IMAGEKIT_PRIVATE_KEY environment variables."
  );
  process.exit(1);
}

const imageKit = new ImageKit({
  publicKey: process.env.IMAGEKIT_PUBLIC_KEY,
  privateKey: process.env.IMAGEKIT_PRIVATE_KEY,
  urlEndpoint: "https://ik.imagekit.io/analysistools",
});

const SCREENSHOTS_JSON_PATH = "screenshots.json";

// Don't overwrite screenshots if they are new enough
const MAX_AGE = 5 * 24 * 60 * 60 * 1000;

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

// Check if file is newer than `MAX_AGE`
const isFresh = (outPath: string): boolean => {
  const fileAge = new Date().getTime() - fs.statSync(outPath).mtime.getTime();
  return fileAge < MAX_AGE;
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

// Helper function to get screenshot path from URL
// Uses URL encoding to get filename
const screenshotUrlToPath = (outDir: string, url: string): string => {
  return `${outDir}/${encodeURIComponent(url)}.jpg`;
};

// Take screenshot of all URLs
const takeNewScreenshots = async (urls: string[], outDir: string) => {
  const takenScreenshots: PathMapping[] = [];

  for (const url of urls) {
    const path = screenshotUrlToPath(outDir, url);

    // takenScreenshots.push({ path, url });

    if (fs.existsSync(path) && isFresh(path)) {
      logger.debug(`[SKIP] ${url}`);
      continue;
    }

    logger.debug(`[LOAD] ${url} (${path})`);
    try {
      // dummy call for testing
      // const success = true;
      const success = await takeScreenshot(url, path);
      if (success) {
        takenScreenshots.push({ path, url });
      }
    } catch (error) {
      logger.error(`[FAIL] Error taking screenshot for ${url}:`, error);
    }
  }

  return takenScreenshots;
};

// Upload screenshot to ImageKit
//
// Returns the URL of the uploaded image, or null if the upload failed
const uploadScreenshotToImageKit = async (
  screenshotPath: string,
  fileName: string
): Promise<string | null> => {
  try {
    logger.info(`[PUSH] Uploading ${screenshotPath} with name ${fileName}`);
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

// Upload all screenshots to ImageKit and update screenshots.json
//
// This function iterates over all tools in the `screenshots` directory and
// uploads all screenshots to ImageKit. It then updates the `screenshots.json`
// file with the new URLs.
const uploadNewScreenshots = async (
  newScreenshots: PathMapping[]
): Promise<PathMapping[]> => {
  const successfullyUploaded: PathMapping[] = [];

  for (const screenshot of newScreenshots) {
    const imageKitUrl = await uploadScreenshotToImageKit(
      screenshot.path,
      screenshot.url
    );

    if (imageKitUrl) {
      successfullyUploaded.push({ path: imageKitUrl, url: screenshot.url });
    }
  }

  return successfullyUploaded;
};

// Generate a screenshot file
// The structure is as follows:
//
// ```json
// {
//   "abaplint": [
//     {
//       "path": "https://ik.imagekit.io/analysistools/abaplint_https_3A_2F_2Fabaplint.org_xntpxy00_b.jpg",
//       "url": "https://abaplint.org"
//     },
//     {
//       "path": "https://ik.imagekit.io/analysistools/abaplint_https_3A_2F_2Fgithub.com_2Fabaplint_2Fabaplint_rn3oxDjX2c.jpg",
//       "url": "https://github.com/abaplint/abaplint"
//     }
//   ],
//   // ...
// }
// ```
//
// where the key is the tool name and the value is an array of PathMapping objects
// (the screenshot URLs and their original URLs)
//
// This merges the new screenshots with the existing `screenshots.json` file
const mergeScreenshotFiles = async (
  newScreenshots: ScreenshotJson
): Promise<ScreenshotJson> => {
  const existingScreenshots: ScreenshotJson = fs.existsSync(
    SCREENSHOTS_JSON_PATH
  )
    ? JSON.parse(fs.readFileSync(SCREENSHOTS_JSON_PATH, "utf-8"))
    : {};

  Object.entries(newScreenshots).forEach(([key, newScreenshotArray]) => {
    const mergedScreenshots = existingScreenshots[key]
      ? mergeExistingAndNewScreenshots(
          existingScreenshots[key],
          newScreenshotArray
        )
      : newScreenshotArray;

    existingScreenshots[key] = mergedScreenshots;
  });

  return existingScreenshots;
};

function mergeExistingAndNewScreenshots(
  existing: PathMapping[],
  news: PathMapping[]
): PathMapping[] {
  const merged = new Map(
    existing.map((screenshot) => [screenshot.url, screenshot])
  );

  news.forEach((newScreenshot) => {
    merged.set(newScreenshot.url, newScreenshot);
  });

  return Array.from(merged.values());
}

// Iterates over all tools and takes screenshots for each tool
// It then uploads the screenshots to ImageKit
// Returns the new screenshots as a JSON object (ScreenshotJson)
const takeAndUploadScreenshotsForTools = async (
  tools: ToolsApiData
): Promise<ScreenshotJson> => {
  const newScreenshotJson: ScreenshotJson = {};

  for (const tool in tools) {
    const outDir = `screenshots/${tool}`;
    fs.mkdirSync(outDir, { recursive: true });

    const urls = loadUrlsForTool(tools[tool]);

    const takenScreenshots = await takeNewScreenshots(urls, outDir);

    if (takenScreenshots.length > 0) {
      logger.info(
        `[LOAD] Took ${takenScreenshots.length} new screenshot(s) for ${tool}. Uploading...`
      );
      const successfullyUploaded = await uploadNewScreenshots(takenScreenshots);
      logger.info(
        `[PUSH] Uploaded ${successfullyUploaded.length} screenshots for ${tool}.`
      );
      newScreenshotJson[tool] = successfullyUploaded;
    }
  }

  return newScreenshotJson;
};

const tools = await downloadToolsApiData();
const newScreenshotJson = await takeAndUploadScreenshotsForTools(tools);
logger.info("[MERGE] Merging screenshots.json");
const mergedScreenshotsJson = await mergeScreenshotFiles(newScreenshotJson);
logger.info("[SAVE] Writing screenshots.json");
const output = JSON.stringify(mergedScreenshotsJson, null, 2);
fs.writeFileSync(SCREENSHOTS_JSON_PATH, output);
logger.info("[DONE] All screenshots taken and uploaded!");
