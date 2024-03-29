import captureWebsite from "capture-website";
import Bottleneck from "bottleneck";
import getYouTubeID from "get-youtube-id";
import fs from "fs";
import fetch from "node-fetch";

const limiter = new Bottleneck({
  maxConcurrent: 4,
  minTime: 500,
});

const SCREENSHOT_OPTIONS = {
  width: 1280,
  scaleFactor: 1.0,
  type: "jpeg",
  quality: 0.95,
  timeout: 20,
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
    ".t-consentPrompt", // pixee.ai
  ],
};

const throttledScreenshot = limiter.wrap(captureWebsite.file);

// Check if the given string is a GitHub repository URL
export const isGithubRepo = (url: string) => {
  const regex = /https:\/\/github.com\/[a-zA-Z0-9-]+\/[a-zA-Z0-9-]+\/?$/;
  // check if url matches regex
  return regex.test(url);
};

const takeGitHubScreenshot = async (url: string, outPath: string) => {
  // Append #readme to the URL to take a screenshot of the README

  url = `${url}#readme`;

  // @ts-ignore
  await throttledScreenshot(url, outPath, {
    ...SCREENSHOT_OPTIONS,
  });
};

const takeNormalScreenshot = async (url: string, outPath: string) => {
  // @ts-ignore
  await throttledScreenshot(url, outPath, SCREENSHOT_OPTIONS);
};

// Get YouTube thumbnail from video URL
const youtubeThumbnail = async (url: string) => {
  const id = getYouTubeID(url);

  if (!id) {
    return;
  }
  const maxUrl = `http://img.youtube.com/vi/${id}/maxresdefault.jpg`;

  // attempt to fetch the thumbnail; if response is 404, return the default
  // thumbnail
  const res = await fetch(maxUrl);
  if (res.status === 404) {
    // Try fallback for unlisted videos. These don't get rendered at the highest
    // resolution.
    const fallback = `http://img.youtube.com/vi/${id}/hqdefault.jpg`;
    return await fetch(fallback);
  }
  return res;
};

// Take a screenshot of `url` and save it to `outPath`
export const takeScreenshot = async (url: string, outPath: string) => {
  // YouTube thumbnail URL
  const res = await youtubeThumbnail(url);
  // if res is 200, we have our thumbnail
  if (res && res.status === 200) {
    const dest = fs.createWriteStream(outPath);
    res.body?.pipe(dest);
    return true;
  }
  if (isGithubRepo(url)) {
    await takeGitHubScreenshot(url, outPath);
  } else {
    // Take a normal website screenshot
    await takeNormalScreenshot(url, outPath);
  }
  return true;
};
