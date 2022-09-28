import { isGithubRepo } from "./index";

test("github repo", () => {
  expect(isGithubRepo("")).toBe(false);
  expect(isGithubRepo("github.com")).toBe(false);
  expect(isGithubRepo("https://github.com")).toBe(false);
  expect(isGithubRepo("https://github.com/foo")).toBe(false);
  expect(isGithubRepo("https://github.com/foo/bar")).toBe(true);
  expect(isGithubRepo("https://github.com/foo/bar/")).toBe(true);
  expect(isGithubRepo("https://github.com/foo/bar/baz")).toBe(false);
  expect(isGithubRepo("https://github.com/foo/bar/baz.txt")).toBe(false);
});
