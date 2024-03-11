/*
 * Takes a screenshot from a website
 * Alternatives considered:
 * - https://www.screenshotapi.io/ - Simple API, not free but cheap. Maybe alternative for the future.
 * - https://github.com/brenden/node-webshot - Very popular, but seems to have a lot of issues.
 */

import captureWebsite from "capture-website";
import Bottleneck from "bottleneck";
import getYouTubeID from "get-youtube-id";
import fs from "fs";
import path from "path";
import dotenv from "dotenv";
import ImageKit from "imagekit";
import fetch from "node-fetch";

dotenv.config();

// Ensure required environment variables are set
if (!process.env.IMAGEKIT_PUBLIC_KEY || !process.env.IMAGEKIT_PRIVATE_KEY) {
  console.error(
    "Please set the IMAGEKIT_PUBLIC_KEY and IMAGEKIT_PRIVATE_KEY environment variables."
  );
  process.exit(1);
}

const imageKit = new ImageKit({
  publicKey: process.env.IMAGEKIT_PUBLIC_KEY,
  privateKey: process.env.IMAGEKIT_PRIVATE_KEY,
  urlEndpoint: "https://ik.imagekit.io/analysistools",
});

const SCREENSHOTS_JSON = "screenshots.json";

// Don't overwrite screenshots if they are new enough
const MAX_AGE = 5 * 24 * 60 * 60 * 1000;

const SCREENSHOT_OPTIONS = {
  width: 1280,
  scaleFactor: 1.0,
  type: "jpeg",
  quality: 0.95,
  timeout: 10,
  overwrite: true,
  darkMode: true,
  removeElements: [
    "#onetrust-consent-sdk",
    ".CookieConsent",
    "#pz-gdpr",
    ".cookie-disclaimer",
    ".cookie-banner",
    ".cookie-notice",
    ".cookie-policy",
    ".cookie-popup",
    ".cookie-accept",
    ".cookie-accepts",
    ".cookie-acceptance",
    ".cookie-acceptance-banner",
    ".cookie-acceptance-container",
    ".cookie-acceptance-overlay",
    ".cookie-acceptance-wrapper",
    ".cookie-accepter",
    ".cookie-acceptor",
    "#CybotCookiebotDialog",
    "#disclaimer",
    "#disclaimer-container",
    ".disclaimer",
    ".disclaimer-container",
    "[id*='sp_message_container']",
    "#gdpr-cookie-message", // rezilion.com
    "#hs-eu-cookie-confirmation", // diffblue.com
    ".cc-floating", // trust-in-soft.com
    "#usercentrics-root", // usercentrics.com used by e.g. snyk.io
    ".adroll_consent_container", // codeclimate.com
  ],
};

const STATIC_TOOLS_JSON_FILE =
  "https://raw.githubusercontent.com/analysis-tools-dev/static-analysis/master/data/api/tools.json";

const DYNAMIC_TOOLS_JSON_FILE =
  "https://raw.githubusercontent.com/analysis-tools-dev/dynamic-analysis/master/data/api/tools.json";

const limiter = new Bottleneck({
  maxConcurrent: 4,
  minTime: 500,
});
const throttledScreenshot = limiter.wrap(captureWebsite.file);

type PathMapping = {
  path: string;
  url: string;
};

export interface ToolsApiData {
  [key: string]: ApiTool;
}

export interface ToolPricePlan {
  free: boolean;
  oss: boolean;
}

export interface ToolResource {
  title: string;
  url: string;
}

export interface ApiTool {
  name: string;
  categories: string[];
  languages: string[];
  other: string[];
  licenses: string[];
  types: string[];
  homepage: string;
  source: string | null;
  pricing: string | null;
  plans: ToolPricePlan | null;
  description: string | null;
  discussion: string | null;
  deprecated: boolean | null;
  resources: ToolResource[] | null;
  wrapper: string | null;
  votes: number;
  upVotes?: number;
  downVotes?: number;
}

// Check if the given string is a GitHub repository URL
export const isGithubRepo = (url: string) => {
  const regex = /https:\/\/github.com\/[a-zA-Z0-9-]+\/[a-zA-Z0-9-]+\/?$/;
  // check if url matches regex
  return regex.test(url);
};

// Get YouTube thumbnail from video URL
const youtubeThumbnail = async (url: string) => {
  const id = getYouTubeID(url);

  if (!id) {
    return;
  }
  const maxUrl = `http://img.youtube.com/vi/${id}/maxresdefault.jpg`;

  // attempt to fetch the thumbnail; if response is 404, return the default thumbnail
  const res = await fetch(maxUrl);
  if (res.status === 404) {
    // Try fallback for unlisted videos. These don't get rendered at the highest resolution.
    const fallback = `http://img.youtube.com/vi/${id}/hqdefault.jpg`;
    return await fetch(fallback);
  }
  return res;
};

// Fetch all screenshot URLs for a tool
const collectUrls = (tool: ApiTool) => {
  const urls = [tool["homepage"]];
  if (tool["source"] && tool["source"] !== tool["homepage"]) {
    urls.push(tool["source"]);
  }
  for (const resource of tool["resources"] || []) {
    urls.push(resource["url"]);
  }
  if (tool["pricing"] != null) {
    urls.push(tool["pricing"]);
  }
  return urls;
};

// Check if file is newer than `MAX_AGE`
const isFresh = (outPath: string) => {
  const fileAge = new Date().getTime() - fs.statSync(outPath).mtime.getTime();
  return fileAge < MAX_AGE;
};

// Get tools from static and dynamic analysis repos
const downloadToolsFromGithub = async (): Promise<ToolsApiData> => {
  const staticResponse = await fetch(STATIC_TOOLS_JSON_FILE);
  const staticTools = (await staticResponse.json()) as ToolsApiData;

  const dynamicResponse = await fetch(DYNAMIC_TOOLS_JSON_FILE);
  const dynamicTools = (await dynamicResponse.json()) as ToolsApiData;

  // Merge static and dynamic tools
  return { ...staticTools, ...dynamicTools };
};

// Helper function to get screenshot path from URL
// Uses URL encoding to get filename
const getScreenshotPathFromUrl = (outDir: string, url: string) => {
  return `${outDir}/${encodeURIComponent(url)}.jpg`;
};

// Take screenshot of all URLs
const takeScreenshots = async (urls: string[], outDir: string) => {
  const newScreenshots: PathMapping[] = [];

  for (const url of urls) {
    const outPath = getScreenshotPathFromUrl(outDir, url);

    if (fs.existsSync(outPath) && isFresh(outPath)) {
      console.log(`Skipping screenshot for ${url} (is fresh)`);
      continue;
    }

    newScreenshots.push({
      path: outPath,
      url,
    });

    console.log(`Fetching screenshot for ${url} to ${outPath}`);

    // Youtube thumbnail URL
    const res = await youtubeThumbnail(url);
    // if res is 200, we have our thumbnail
    if (res && res.status === 200) {
      const dest = fs.createWriteStream(outPath);
      res.body?.pipe(dest);
      continue;
    }
    // Otherwise it's a normal website screenshot
    try {
      if (isGithubRepo(url)) {
        // @ts-ignore
        await throttledScreenshot(url, outPath, {
          ...SCREENSHOT_OPTIONS,
          waitForElement: "#readme",
          scrollToElement: "#readme",
        });
      } else {
        // @ts-ignore
        await throttledScreenshot(url, outPath, SCREENSHOT_OPTIONS);
      }
    } catch (err) {
      console.log(`Error fetching screenshot for ${url}: ${err}`);
    }
  }

  return newScreenshots;
};

const uploadScreenshots = async (tools: string[]) => {
  for (const tool of tools) {
    const screenshots = fs
      .readdirSync(path.join("screenshots", tool))
      .filter((file) => !file.startsWith("."));

    const newScreenshots: PathMapping[] = [];

    for (const screenshot of screenshots) {
      const screenshotPath = path.join("screenshots", tool, screenshot);
      console.log(`Handling ${screenshotPath}`);

      const created = fs.statSync(screenshotPath).ctime.getTime();
      const yesterday = Date.now() - 86400000;

      if (created <= yesterday) {
        console.log("Screenshot was not changed recently. Skipping");
        continue;
      }

      console.log(
        `Uploading ${screenshotPath}. Changed ${new Date(
          created
        ).toISOString()}`
      );

      // Load screenshot from disk
      const screenshotFile = fs.readFileSync(screenshotPath);
      const encodedImageData = screenshotFile.toString("base64");

      const filePath = path.join(tool, screenshot);

      console.log("Uploading file to ImageKit");
      try {
        const response = await imageKit.upload({
          file: encodedImageData,
          fileName: filePath,
          folder: "/screenshots/",
        });

        console.log("ImageKit response:", response);

        const url = response.url;

        if (!url) {
          console.error(`Error getting CDN image URL for ${filePath}`);
          continue;
        }

        console.log(`Image uploaded to ${url}`);

        // Add screenshot to JSON object
        newScreenshots.push({
          path: filePath,
          url,
        });
      } catch (error) {
        console.error("Error during ImageKit upload:", error);
      }
    }
  }
};

// Create screenshots.json file
export const generateScreenshotFile = async () => {
  // Get all tool names from the `screenshots` directory
  const tools = fs
    .readdirSync("screenshots")
    .filter((file) => !file.startsWith("."));

  console.log(`Found ${tools.length} tools with screenshots.`);

  // Load existing screenshots.json file if exists
  let json: { [key: string]: PathMapping[] } = {};
  if (fs.existsSync(SCREENSHOTS_JSON)) {
    json = JSON.parse(fs.readFileSync(SCREENSHOTS_JSON, "utf-8"));
    const total = Object.values(json).flat().length;
    console.log(
      `Loaded ${total} screenshots from existing screenshots.json file.`
    );
  }

  const screenshots = uploadScreenshots(tools);
  fs.writeFileSync(SCREENSHOTS_JSON, JSON.stringify(screenshots, null, 2));
};

console.log("Downloading tool files from GitHub");
const tools: ToolsApiData = await downloadToolsFromGithub();

console.log("Taking screenshots");
for (const tool in tools) {
  const outDir = `screenshots/${tool}/`;
  fs.mkdirSync(outDir, { recursive: true });

  const urls = collectUrls(tools[tool]);
  const newScreenshots = await takeScreenshots(urls, outDir);
  console.log(`Took ${newScreenshots.length} new screenshots for ${tool}`);
  console.log(
    newScreenshots
      .map((s) => `  - ${s.url} -> ${s.path}`)
      .join("\n")
      .trim()
  );
}

console.log("Uploading screenshots to ImageKit");
await generateScreenshotFile();
console.log("Done");
