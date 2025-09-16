// Mock external dependencies that have ESM issues
jest.mock("capture-website", () => ({
  __esModule: true,
  default: {
    file: jest.fn(),
  },
}));

jest.mock("node-fetch", () => ({
  __esModule: true,
  default: jest.fn(),
}));

// Import after mocking
import { isGithubRepo } from "./screenshot";

describe("GitHub Repository Detection", () => {
  test("should detect valid GitHub repository URLs", () => {
    expect(isGithubRepo("https://github.com/foo/bar")).toBe(true);
    expect(isGithubRepo("https://github.com/foo/bar/")).toBe(true);
  });

  test("should reject invalid GitHub URLs", () => {
    expect(isGithubRepo("")).toBe(false);
    expect(isGithubRepo("github.com")).toBe(false);
    expect(isGithubRepo("https://github.com")).toBe(false);
    expect(isGithubRepo("https://github.com/foo")).toBe(false);
    expect(isGithubRepo("https://github.com/foo/bar/baz")).toBe(false);
    expect(isGithubRepo("https://github.com/foo/bar/baz.txt")).toBe(false);
  });
});
