/*
 * Takes a screenshot from a website
 * Alternatives considered:
 * - https://www.screenshotapi.io/ - Simple API, not free but cheap. Maybe alternative for the future.
 * - https://github.com/brenden/node-webshot - Very popular, but seems to have a lot of issues.
 */

import captureWebsite, { FileOptions } from "capture-website";
import Bottleneck from "bottleneck";
import fetch from "node-fetch";
import fs from "fs";

// Don't overwrite screenshots if they are new enough
const MAX_SCREENSHOT_AGE = 5 * 24 * 60 * 60 * 1000;

const limiter = new Bottleneck({
  maxConcurrent: 4,
  minTime: 500,
});
const throttledScreenshot = limiter.wrap(captureWebsite.file);

const TOOLS_JSON_FILE =
  "https://raw.githubusercontent.com/analysis-tools-dev/static-analysis/master/data/api/tools.json";

const getScreenshot = async (url: string, name: string) => {
  const outDir = "screenshots";
  const outPath = `${outDir}/${name}.jpg`;

  if (fs.existsSync(outPath)) {
    // Keep file if it is newer than `MAX_SCREENSHOT_AGE`
    const fileAge = new Date().getTime() - fs.statSync(outPath).mtime.getTime();
    if (fileAge < MAX_SCREENSHOT_AGE) {
      return;
    }
  }

  const screenshotOptions: FileOptions = {
    width: 1280,
    scaleFactor: 1.0,
    type: "jpeg",
    quality: 0.95,
    timeout: 30,
    delay: 2,
    overwrite: true,
    darkMode: true,
    waitForElement: undefined,
  };

  if (url.includes("github.com")) {
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    screenshotOptions.waitForElement = "#readme";
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    screenshotOptions.scrollToElement = "#readme";
  }

  console.log(`Fetching screenshot for ${url}`);
  try {
    fs.mkdirSync(outDir, { recursive: true });
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    await throttledScreenshot(url, outPath, screenshotOptions);
  } catch (err) {
    console.log(`Error fetching screenshot for ${url}: ${err}`);
  }
};

const response = await fetch(TOOLS_JSON_FILE);
const body = await response.text();
const json = JSON.parse(body);
for (const tool in json) {
  const homepage = json[tool]["homepage"];
  console.log(`Fetching ${homepage}...`);
  getScreenshot(homepage, tool);
}
