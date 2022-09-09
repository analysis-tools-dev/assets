/*
 * Takes a screenshot from a website
 * Alternatives considered:
 * - https://www.screenshotapi.io/ - Simple API, not free but cheap. Maybe alternative for the future.
 * - https://github.com/brenden/node-webshot - Very popular, but seems to have a lot of issues.
 */

import captureWebsite from "capture-website";
import Bottleneck from "bottleneck";
import fetch from "node-fetch";
import getYouTubeID from "get-youtube-id";
import fs from "fs";

// Don't overwrite screenshots if they are new enough
const MAX_SCREENSHOT_AGE = 5 * 24 * 60 * 60 * 1000;

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
    "#disclaimer",
    "#disclaimer-container",
    ".disclaimer",
    ".disclaimer-container",
    "[id*='sp_message_container']",
  ],
};

const TOOLS_JSON_FILE =
  "https://raw.githubusercontent.com/analysis-tools-dev/static-analysis/master/data/api/tools.json";

const limiter = new Bottleneck({
  maxConcurrent: 4,
  minTime: 500,
});
const throttledScreenshot = limiter.wrap(captureWebsite.file);

// Get youtube thumbnail URL from video URL
const youtubeThumbnail = (url: string) => {
  const id = getYouTubeID(url);

  if (!id) {
    return;
  }
  return `http://img.youtube.com/vi/${id}/maxresdefault.jpg`;
};

// Fetch all screenshot URLs for tool
const collectUrls = (tool: any) => {
  const urls = [tool["homepage"]];
  if (tool["source"] && tool["source"] !== tool["homepage"]) {
    urls.push(tool["source"]);
  }
  for (const resource of tool["resources"] || []) {
    urls.push(resource["url"]);
  }
  return urls;
};

// Check if screenshot is newer than `MAX_SCREENSHOT_AGE`
const isFreshScreenshot = (outPath: string) => {
  const fileAge = new Date().getTime() - fs.statSync(outPath).mtime.getTime();
  return fileAge < MAX_SCREENSHOT_AGE;
};

// Take screenshot of all URLs
const fetchScreenshots = async (urls: string[], outDir: string) => {
  // iterate over all urls with index
  for (const [index, url] of urls.entries()) {
    const outPath = `${outDir}${index}.jpg`;

    if (fs.existsSync(outPath) && isFreshScreenshot(outPath)) {
      console.log(`Screenshot for ${url} is fresh. Skipping.`);
      continue;
    }

    console.log(`Fetching screenshot for ${url} to ${outPath}`);

    // Youtube thumbnail URL
    const thumbnail = youtubeThumbnail(url);
    if (thumbnail) {
      await fetch(thumbnail).then((res: any) => {
        const dest = fs.createWriteStream(outPath);
        res.body?.pipe(dest);
      });
      continue;
    }
    // Normal website screenshot
    try {
      if (url.includes("github.com")) {
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
};

const response = await fetch(TOOLS_JSON_FILE);
const json: any = await response.json();

for (const tool in json) {
  const outDir = `screenshots/${tool}/`;
  fs.mkdirSync(outDir, { recursive: true });

  const urls = collectUrls(json[tool]);
  fetchScreenshots(urls, outDir);
}
