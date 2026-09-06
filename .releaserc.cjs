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
    // NOTE: `@semantic-release/git` is deliberately NOT in this list.
    //
    // It commits and pushes the version bump per package, which in this
    // monorepo meant one push to `main` for every released package: eight
    // pushes to the same ref inside about forty seconds. GitHub intermittently
    // applies such a ref update and still reports it rejected
    // ("cannot lock ref 'refs/heads/main': is at X but expected Y"), which
    // aborts multi-semantic-release mid-run and strands packages that were
    // tagged but never published, plus published packages pinning versions
    // that do not exist.
    //
    // The version bumps and changelogs written here are instead committed and
    // pushed ONCE by the "Commit release metadata" step in
    // .github/workflows/publish.yml, after every package has published.
    // Keep that step and this omission in sync.
    [
      '@semantic-release/github',
      {
        // Keep the release job at contents:write only; issue/PR notifications
        // would otherwise require two additional write scopes.
        successCommentCondition: false,
        failCommentCondition: false,
        releasedLabels: false,
      },
    ],
  ],
};
