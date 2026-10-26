/*
 * Prints the CHANGELOG.md section for a version, for the GitHub release notes.
 * Usage: node scripts/release-notes.cjs v1.2.0
 */
const fs = require('node:fs');
const path = require('node:path');

/** The lines under `## <version>` up to the next version heading, without the heading. */
function releaseNotes(changelog, version) {
  const lines = changelog.split(/\r?\n/);
  const start = lines.findIndex((line) => new RegExp(`^## ${escape(version)}( |$)`).test(line));
  if (start < 0) throw new Error(`CHANGELOG.md has no section for ${version}.`);
  const end = lines.findIndex((line, index) => index > start && line.startsWith('## '));
  return (
    lines
      .slice(start + 1, end < 0 ? undefined : end)
      .join('\n')
      .trim() + '\n'
  );
}
const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

if (require.main === module) {
  const version = (process.argv[2] ?? '').replace(/^v/, '');
  const changelog = fs.readFileSync(path.join(__dirname, '..', 'CHANGELOG.md'), 'utf8');
  process.stdout.write(releaseNotes(changelog, version));
}

module.exports = { releaseNotes };
