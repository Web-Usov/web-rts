import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isValidBranchName } from './validate-branch-name.mjs';

const valid = [
  'feature/g4c-87',
  'feature/87',
  'feature/g4c-87-cpu-budget',
  'feature/87-cpu-budget',
  'feature/mesh-viewer',
  'fix/typo',
  'fix/f9-14',
  'doc/update-project-status',
  'doc/89',
  'chore/89',
  'chore/ci-cache',
];

const invalid = [
  '',
  'main',
  'codex/mesh-viewer',
  'docs/update-project-status',
  'Feature/g4c-87',
  'feature/G4c-87',
  'feature/g4c_87',
  'feature/g4c-087',
  'feature/g4c-0',
  'feature/0',
  'feature/087',
  'feature/',
  'feature//87',
  'feature/-87',
  'feature/87-',
  'feature/87--typo',
  'feature/mesh_viewer',
  'feature/mesh viewer',
  'feature/mesh-viewer/',
];

for (const name of valid) {
  test(`accept ${name}`, () => assert.equal(isValidBranchName(name), true));
}

for (const name of invalid) {
  test(`reject ${JSON.stringify(name)}`, () =>
    assert.equal(isValidBranchName(name), false),
  );
}
