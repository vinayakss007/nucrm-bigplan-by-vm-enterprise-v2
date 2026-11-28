import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const WORKFLOW = join(import.meta.dirname!, '../../.github/workflows/release.yml');
const source = readFileSync(WORKFLOW, 'utf8');

describe('release workflow dispatch input guard (#4020)', () => {
  it('allowlists the dispatch tag input before it is used by any git command', () => {
    const check = source.indexOf("grep -Eq '^v[0-9]+\\.[0-9]+\\.[0-9]+(-[0-9A-Za-z.-]+)?$'");
    const tagUse = source.indexOf('TAG="${INPUT_TAG:-$GITHUB_REF_NAME}"');
    const checkout = source.indexOf('git checkout --detach');
    expect(check).toBeGreaterThan(-1);
    expect(check).toBeLessThan(tagUse);
    expect(check).toBeLessThan(checkout);
  });

  it('still verifies the tag exists and is an ancestor of main', () => {
    expect(source).toContain('git merge-base --is-ancestor "$SHA" "$MAIN_SHA"');
    expect(source).toContain('refs/tags/$TAG');
  });

  it('keeps the semver and package-version agreement checks', () => {
    expect(source).toContain('"v$VERSION" != "$TAG"');
  });
});
