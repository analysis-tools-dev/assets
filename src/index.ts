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
  timeout: 30,
  waitUntil: "networkidle0", // Wait until network is idle
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
    ".cky-overlay", // bugprove.com
    ".cky-consent-container", // bugprove.com
    ".cookiefirst-root", // claranet.com
    ".cc-banner", // https://eclipse.dev/cognicrypt
    ".onetrust-consent-sdk", // https://www.microfocus.com/en-us/cyberres/application-security
    "#iubenda-cs-banner", // https://docs.gitguardian.com/
    ".truste_box_overlay", // redhat
    ".truste_overlay", // redhat
    ".qc-cmp2-container", // mathworks.com
    ".cmpboxBG", // sourceforge.net
    ".cmpbox", // sourceforge.net
    ".personal-data-confirm", // https://pvs-studio.com/en/pvs-studio/
    ".block-cookie-block", // https://www.hackerone.com/
    ".jetbrains-cookies-banner", // https://www.jetbrains.com/
    ".wt-cli-cookie-bar-container", // https://www.styra.com
    ".gdprconsent-container", // https://engineering.fb.com/
    ".q-cookie-consent__container q-cookie-consent__open", // https://www.qualys.com/
    "#cookie-consent", // https://steampunk.si/spotter/
    ".ch2-container", // https://smartbear.com/
    ".md-consent", // https://unimport.hakancelik.dev/latest/
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

// Reverse operation, which converts strings like
// https%3A%2F%2Fgithub.com%2Flarshp%2FabapOpenChecks.jpg
// to a URL like
// https://github.com/larshp/abapOpenChecks
const getUrlFromScreenshotPath = (path: string) => {
  return decodeURIComponent(path.replace(/\.jpg$/, ""));
};

const downloadScreenshot = async (url: string, outPath: string) => {
  // YouTube thumbnail URL
  const res = await youtubeThumbnail(url);
  // if res is 200, we have our thumbnail
  if (res && res.status === 200) {
    const dest = fs.createWriteStream(outPath);
    res.body?.pipe(dest);
    return true;
  }
  // Otherwise it's a normal website screenshot
  if (isGithubRepo(url)) {
    try {
      // @ts-ignore
      await throttledScreenshot(url, outPath, {
        ...SCREENSHOT_OPTIONS,
        waitForElement: "#readme",
        scrollToElement: "#readme",
      });
      return true;
    } catch (err) {
      console.log(`[FAIL] Error fetching GitHub screenshot for ${url}: ${err}`);
      return false;
    }
  }

  try {
    // @ts-ignore
    await throttledScreenshot(url, outPath, SCREENSHOT_OPTIONS);
    return true;
  } catch (err) {
    console.log(`[FAIL] Error fetching normal screenshot for ${url}: ${err}`);
    return false;
  }
};

// Take screenshot of all URLs
const takeScreenshots = async (urls: string[], outDir: string) => {
  const newScreenshots: PathMapping[] = [];

  for (const url of urls) {
    const screenshotFsPath = getScreenshotPathFromUrl(outDir, url);

    if (fs.existsSync(screenshotFsPath) && isFresh(screenshotFsPath)) {
      console.log(`[SKIP] ${url}`);
      continue;
    }

    console.log(`[LOAD] Fetching screenshot for ${url} to ${screenshotFsPath}`);
    const success = await downloadScreenshot(url, screenshotFsPath);
    if (success) {
      newScreenshots.push({ path: screenshotFsPath, url });
    }
  }

  return newScreenshots;
};

// Upload screenshot to ImageKit
//
// Returns the URL of the uploaded image, or null if the upload failed
const uploadScreenshotToImageKit = async (
  screenshotPath: string,
  fileName: string
): Promise<string | null> => {
  try {
    const response = await imageKit.upload({
      file: fs.readFileSync(screenshotPath), // Directly pass the file buffer
      fileName: fileName,
      useUniqueFileName: true,
    });
    return response.url;
  } catch (error) {
    console.error("Error uploading file to ImageKit:", error);
    return null;
  }
};

// Update screenshots.json file with new screenshots
//
// `tool` is the name of the tool
// `newScreenshots` is an array of PathMapping objects (the new screenshots)
const updateScreenshotsJson = async (
  tool: string,
  newScreenshots: PathMapping[]
) => {
  let json: { [key: string]: PathMapping[] } = {};

  if (fs.existsSync(SCREENSHOTS_JSON)) {
    json = JSON.parse(fs.readFileSync(SCREENSHOTS_JSON, "utf8"));
  }
  // Merge new screenshots with existing ones
  // Make sure that the URL is unique
  if (json[tool]) {
    const existingUrls = json[tool].map((s) => s.url);
    for (const newScreenshot of newScreenshots) {
      if (!existingUrls.includes(newScreenshot.url)) {
        json[tool].push(newScreenshot);
      }
    }
  } else {
    json[tool] = newScreenshots;
  }

  console.log(`Final JSON object before writing to file:`, json);
  fs.writeFileSync(SCREENSHOTS_JSON, JSON.stringify(json, null, 2));
};

// Upload all screenshots to ImageKit and update screenshots.json
//
// This function iterates over all tools in the `screenshots` directory and
// uploads all screenshots to ImageKit. It then updates the `screenshots.json`
// file with the new URLs.
const uploadScreenshots = async () => {
  const tools = fs
    .readdirSync("screenshots")
    .filter((file) => !file.startsWith("."));

  for (const tool of tools) {
    const screenshotsDir = path.join("screenshots", tool);
    const screenshots = fs
      .readdirSync(screenshotsDir)
      .filter((file) => !file.startsWith("."));

    const newScreenshots: PathMapping[] = [];

    for (const screenshot of screenshots) {
      const screenshotPath = path.join(screenshotsDir, screenshot);
      console.log(`[PUSH] Uploading ${screenshotPath}...`);

      const imageKitUrl = await uploadScreenshotToImageKit(
        screenshotPath,
        screenshot
      );

      if (imageKitUrl) {
        const url = getUrlFromScreenshotPath(screenshot);
        newScreenshots.push({ path: imageKitUrl, url });
      }
    }

    if (newScreenshots.length > 0) {
      console.log(`New screenshots for tool ${tool}:`, newScreenshots);
      await updateScreenshotsJson(tool, newScreenshots);
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

  await uploadScreenshots();
};

const tools: ToolsApiData = await downloadToolsFromGithub();

for (const tool in tools) {
  const outDir = `screenshots/${tool}`;
  fs.mkdirSync(outDir, { recursive: true });

  const urls = collectUrls(tools[tool]);
  const newScreenshots = await takeScreenshots(urls, outDir);
  if (newScreenshots.length > 0) {
    console.log(
      `[DONE] Took ${newScreenshots.length} new screenshots for ${tool}`
    );
    console.log(
      newScreenshots.map((s) => `[DONE]  - ${s.url} -> ${s.path}`).join("\n")
    );
  }
}

console.log("Uploading screenshots to ImageKit");
await generateScreenshotFile();
console.log("Done");
