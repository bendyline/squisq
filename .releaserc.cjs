/* global module, process */

const forceMajor = process.env.SEMANTIC_RELEASE_FORCE_MAJOR === 'true';

const commitAnalyzerOptions = {
  preset: 'conventionalcommits',
  ...(forceMajor
    ? {
        // Promote commits that would normally trigger a patch or minor release.
        // Commits that do not trigger a release remain non-releasing.
        releaseRules: [
          { breaking: true, release: 'major' },
          { revert: true, release: 'major' },
          { type: 'feat', release: 'major' },
          { type: 'fix', release: 'major' },
          { type: 'perf', release: 'major' },
        ],
      }
    : {}),
};

module.exports = {
  branches: ['main'],
  plugins: [
    ['@semantic-release/commit-analyzer', commitAnalyzerOptions],
    [
      '@semantic-release/release-notes-generator',
      {
        preset: 'conventionalcommits',
      },
    ],
    [
      '@semantic-release/changelog',
      {
        changelogFile: 'CHANGELOG.md',
      },
    ],
    [
      '@semantic-release/npm',
      {
        npmPublish: true,
        provenance: true,
      },
    ],
    [
      '@semantic-release/git',
      {
        assets: ['CHANGELOG.md', 'package.json', 'package-lock.json'],
        message: 'chore(release): ${nextRelease.version} [skip ci]\n\n${nextRelease.notes}',
      },
    ],
    ['@semantic-release/github'],
  ],
};
