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
  ],
};

const TOOLS_JSON_FILE =
  "https://raw.githubusercontent.com/analysis-tools-dev/static-analysis/master/data/api/tools.json";

const limiter = new Bottleneck({
  maxConcurrent: 4,
  minTime: 500,
});
const throttledScreenshot = limiter.wrap(captureWebsite.file);

export const isGithubRepo = (url: string) => {
  const regex = /https:\/\/github.com\/[a-zA-Z0-9-]+\/[a-zA-Z0-9-]+\/?$/;
  // check if url matches regex
  return regex.test(url);
};

// Get youtube thumbnail from video URL
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

// Check if file is newer than `MAX_AGE`
const isFresh = (outPath: string) => {
  const fileAge = new Date().getTime() - fs.statSync(outPath).mtime.getTime();
  return fileAge < MAX_AGE;
};

// Take screenshot of all URLs
const fetchScreenshots = async (urls: string[], outDir: string) => {
  // iterate over all urls
  for (const url of urls) {
    // urlencode url to get filename
    const outPath = `${outDir}/${encodeURIComponent(url)}.jpg`;

    if (fs.existsSync(outPath) && isFresh(outPath)) {
      console.log(`Screenshot for ${url} is fresh. Skipping.`);
      continue;
    }

    console.log(`Fetching screenshot for ${url} to ${outPath}`);

    // Youtube thumbnail URL
    const res = await youtubeThumbnail(url);
    // if res is 200, we have our thumbnail
    if (res && res.status === 200) {
      const dest = fs.createWriteStream(outPath);
      res.body?.pipe(dest);
      continue;
    }
    // Normal website screenshot
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
};

const response = await fetch(TOOLS_JSON_FILE);
const json: any = await response.json();

for (const tool in json) {
  const outDir = `screenshots/${tool}/`;
  fs.mkdirSync(outDir, { recursive: true });

  const urls = collectUrls(json[tool]);
  fetchScreenshots(urls, outDir);
}
