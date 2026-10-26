import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

const { releaseNotes } = createRequire(import.meta.url)('../scripts/release-notes.cjs') as {
  releaseNotes: (changelog: string, version: string) => string;
};

it('takes one version section of the changelog without its heading', () => {
  const changelog = [
    '# Changelog',
    '',
    '## 1.1.0 - 2026-11-02',
    '',
    '- Newer.',
    '',
    '## 1.0.0 - 2026-10-26',
    '',
    '- First.',
  ].join('\n');
  expect(releaseNotes(changelog, '1.1.0')).toBe('- Newer.\n');
  expect(releaseNotes(changelog, '1.0.0')).toBe('- First.\n');
  expect(() => releaseNotes(changelog, '1.0')).toThrow('no section');
});

it('has notes for the version in package.json', () => {
  const { version } = JSON.parse(readFileSync('package.json', 'utf8'));
  expect(releaseNotes(readFileSync('CHANGELOG.md', 'utf8'), version).length).toBeGreaterThan(10);
});
