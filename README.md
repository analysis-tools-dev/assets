# 🎨 Assets

 <a href="https://analysis-tools.dev/">
   <img alt="Analysis Tools Website" src="https://raw.githubusercontent.com/analysis-tools-dev/assets/master/static/redesign.svg" />
 </a>

## Sponsors

Thank you to CodeRabbit for sponsoring this project, and to everyone who has supported it over the years.

<a href="https://coderabbit.ai">
  <img width="200px" alt="CodeRabbit" src="https://raw.githubusercontent.com/analysis-tools-dev/assets/master/static/sponsors/code-rabbit.svg" />
</a>

Support this project through [GitHub Sponsors](https://github.com/sponsors/analysis-tools-dev) or [Open Collective](https://opencollective.com/analysis-tools).

Contains analysis tool screenshots used for the tools pages on [our website](https://analysis-tools.dev/).  
Screenshots are created via a Github actions pipeline and some glue code.

## Usage

```
npm run dev
```

### Freshness and retries

`screenshots.json` keeps its existing public format. The sidecar
`screenshots.metadata.json` records capture and publication timestamps (Unix
milliseconds) and the CDN path for each tool URL. A screenshot is fresh for five
days after capture only if its upload succeeded and its recorded CDN path matches
the manifest. Local file timestamps do not count: a checkout must not make an old
screenshot look new. Missing metadata, including legacy entries, means stale.
The first run after this change will therefore refresh legacy screenshots.

`npm run dev -- --force` ignores freshness. Failed captures or uploads keep the
last successful mapping but clear its freshness metadata so the next run retries.
The command saves successful partial progress, reports capture and upload failure
counts, and exits nonzero if either count is nonzero. CI commits that progress,
including the sidecar, even when capture fails; the job stays failed and does not
trigger a website redeploy.

`npm run dev -- --dry-run` lists the work without capturing, uploading, or changing
local files, the manifest, or metadata. It still downloads the tool lists but does
not require ImageKit credentials. Combine it with `--force` to preview a full
refresh.
