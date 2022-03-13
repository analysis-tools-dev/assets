/*
 * Take a screenshot from a website
 * Alternatives considered:
 * - https://www.screenshotapi.io/ - Simple API, not free but cheap. Maybe alternative for the future.
 * - https://github.com/brenden/node-webshot - Very popular, but seems to have a lot of issues.
 */
import captureWebsite from "capture-website";
import Bottleneck from "bottleneck";
import fetch from "node-fetch";
import fs from "fs";

const limiter = new Bottleneck({
  maxConcurrent: 4,
  minTime: 500,
});
const throttledScreenshot = limiter.wrap(captureWebsite.file);
const toolsJson =
  "https://raw.githubusercontent.com/analysis-tools-dev/static-analysis/master/data/api/tools.json";

const getScreenshot = async (url, name) => {
  let screenshotOptions = {
    width: 1280,
    scaleFactor: 1.0,
    quality: 0.95,
    overwrite: false,
    type: "jpeg",
  };

  let outDir = "screenshots";
  if (url.includes("github.com")) {
    screenshotOptions.waitForElement = "#readme";
    screenshotOptions.scrollToElement = "#readme";
  }

  // Remove protocol from url for nicer file names.
  const urlClean = url.replace(/(^\w+:|^)\/\/(www)?/, "");
  const outPath = `${outDir}/${name}.jpg`;

  if (fs.existsSync(outPath)) {
    return;
  }

  console.log(`Fetching screenshot for ${url}`);
  try {
    fs.mkdirSync(outDir, { recursive: true });
    await throttledScreenshot(url, outPath, screenshotOptions);
  } catch (err) {
    console.log(err);
  }
};

const response = await fetch(toolsJson);
const body = await response.text();
const json = JSON.parse(body);
for (var tool in json) {
  const homepage = json[tool]["homepage"];
  const name = tool;
  console.log(`Fetching ${homepage}...`);
  getScreenshot(homepage, name);
}
