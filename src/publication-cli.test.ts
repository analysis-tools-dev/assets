import fs from "fs";
import path from "path";
import vm from "vm";
import ts from "typescript";
import * as publication from "./publication";

// Execute the real entry point with every external dependency replaced. The async
// wrapper supports its top-level await without importing capture/browser modules.
const entryPoint = ts.transpileModule(
  fs.readFileSync(path.join(__dirname, "index.ts"), "utf8"),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } },
).outputText;

async function runCli(dryRun = false, fail = true) {
  const files = new Map<string, string>([["screenshots.json", JSON.stringify({
    tool: [{ url: "https://upload-fails.example", path: "old-cdn-path" }],
  })]]);
  const capture = jest.fn(async (url: string) => !fail || url !== "https://capture-fails.example");
  const upload = jest.fn(async ({ fileName }: { fileName: string }) => {
    if (fail && fileName === "https://upload-fails.example") throw new Error("upload failure");
    return { url: "new-cdn-path" };
  });
  const processStub = {
    argv: dryRun ? ["--dry-run", "--force"] : [],
    env: dryRun ? {} : { IMAGEKIT_PUBLIC_KEY: "test-only", IMAGEKIT_PRIVATE_KEY: "test-only" },
    exitCode: 0,
    exit: jest.fn(() => { throw new Error("unexpected exit"); }),
  };
  const write = jest.fn((name: string, content: string) => {
    expect(processStub.exitCode).toBe(0);
    files.set(name, content);
  });
  const mkdir = jest.fn();
  const error = jest.fn();
  const imageKit = jest.fn(() => ({ upload }));
  const dependencies: Record<string, unknown> = {
    fs: {
      existsSync: (name: string) => files.has(name),
      readFileSync: (name: string) => files.get(name) ?? Buffer.from("captured image"),
      writeFileSync: write,
      mkdirSync: mkdir,
    },
    dotenv: { config: jest.fn() },
    imagekit: imageKit,
    "node-fetch": jest.fn(async () => ({ json: async () => ({ tool: {
      homepage: "https://success.example",
      source: "https://capture-fails.example",
      pricing: "https://upload-fails.example",
    } }) })),
    tslog: { Logger: jest.fn(() => ({ info: jest.fn(), error })) },
    "./screenshot": { takeScreenshot: capture },
    "./publication": publication,
  };
  await vm.runInNewContext(`(async () => { ${entryPoint}\n })()`, {
    exports: {}, process: processStub,
    require: (name: string) => {
      if (!(name in dependencies)) throw new Error(`Unexpected import: ${name}`);
      return dependencies[name];
    },
  });
  return { files, capture, upload, write, mkdir, error, processStub, imageKit };
}

test("CLI persists partial successes and old mappings before exiting nonzero", async () => {
  const result = await runCli();
  expect(result.processStub.exitCode).toBe(1);
  expect(result.error).toHaveBeenCalledWith(expect.stringContaining("1 capture failure(s), 1 upload failure(s)"));
  expect(result.write.mock.calls.map(([name]) => name)).toEqual(["screenshots.json", "screenshots.metadata.json"]);
  expect(JSON.parse(result.files.get("screenshots.json")!)).toEqual({ tool: [
    { url: "https://upload-fails.example", path: "old-cdn-path" },
    { url: "https://success.example", path: "new-cdn-path" },
  ] });
  const metadata = JSON.parse(result.files.get("screenshots.metadata.json")!);
  expect(Object.keys(metadata.tool)).toEqual(["https://success.example"]);
});

test("CLI dry run needs no credentials and performs no captures, uploads, or writes", async () => {
  const result = await runCli(true);
  expect(result.processStub.exitCode).toBe(0);
  for (const mock of [result.capture, result.upload, result.write, result.mkdir, result.imageKit]) {
    expect(mock).not.toHaveBeenCalled();
  }
  expect(result.files.has("screenshots.metadata.json")).toBe(false);
});

test("CLI successful run saves publication metadata and exits successfully", async () => {
  const result = await runCli(false, false);
  expect(result.processStub.exitCode).toBe(0);
  expect(result.error).not.toHaveBeenCalled();
  expect(Object.keys(JSON.parse(result.files.get("screenshots.metadata.json")!).tool)).toHaveLength(3);
});
