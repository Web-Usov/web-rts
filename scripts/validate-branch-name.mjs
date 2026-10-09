import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

const PREFIX_PATTERN = /^(?:feature|fix|doc|chore)\/(.+)$/;
const ISSUE_PATTERN = /^[1-9][0-9]*(?:-[a-z0-9]+)*$/;
const STAGE_ISSUE_PATTERN = /^[a-z][0-9]+[a-z]*-[1-9][0-9]*(?:-[a-z0-9]+)*$/;
const STAGE_NUMBER_PATTERN = /^[a-z][0-9]+[a-z]*-[0-9]/;
const SLUG_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;

export function isValidBranchName(name) {
  if (typeof name !== "string") {
    return false;
  }

  const match = PREFIX_PATTERN.exec(name);
  if (!match) {
    return false;
  }

  const suffix = match[1];
  if (ISSUE_PATTERN.test(suffix)) {
    return true;
  }
  // Do not mistake a malformed stage/issue pair for an issue-less slug.
  if (STAGE_NUMBER_PATTERN.test(suffix)) {
    return STAGE_ISSUE_PATTERN.test(suffix);
  }
  return SLUG_PATTERN.test(suffix);
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const branch = process.argv[2];
  if (!isValidBranchName(branch)) {
    console.error(`Invalid PR branch name: ${JSON.stringify(branch ?? "")}`);
    console.error(
      "Expected: feature|fix|doc|chore/<stage>-<issue>[-description], <issue>[-description], or <description>.",
    );
    console.error(
      "Examples: feature/g4c-87, feature/87, fix/typo, doc/update-project-status, chore/ci-cache.",
    );
    process.exitCode = 1;
  } else {
    console.log(`Valid PR branch name: ${branch}`);
  }
}
