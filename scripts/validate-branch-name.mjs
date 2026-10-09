import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const NAME_PATTERN = /^(?:feature|fix|doc|chore)\/(?:[a-z][0-9]+[a-z]*-[1-9][0-9]*(?:-[a-z0-9]+(?:-[a-z0-9]+)*)?|[1-9][0-9]*(?:-[a-z0-9]+(?:-[a-z0-9]+)*)?|[a-z][a-z0-9]*(?:-[a-z0-9]+)*)$/;

export function isValidBranchName(name) {
  if (typeof name !== 'string' || !NAME_PATTERN.test(name)) {
    return false;
  }

  // Do not mistake a malformed stage/issue pair for an issue-less slug.
  const suffix = name.slice(name.indexOf('/') + 1);
  if (/^[a-z][0-9]+[a-z]*-[0-9]/.test(suffix)) {
    return /^[a-z][0-9]+[a-z]*-[1-9][0-9]*(?:-[a-z0-9]+)*$/.test(suffix);
  }

  return true;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const branch = process.argv[2];
  if (!isValidBranchName(branch)) {
    console.error(`Invalid PR branch name: ${JSON.stringify(branch ?? '')}`);
    console.error('Expected: feature|fix|doc|chore/<stage>-<issue>[-description], <issue>[-description], or <description>.');
    console.error('Examples: feature/g4c-87, feature/87, fix/typo, doc/update-project-status, chore/ci-cache.');
    process.exitCode = 1;
  } else {
    console.log(`Valid PR branch name: ${branch}`);
  }
}
