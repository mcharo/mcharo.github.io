# mcharo.github.io

A one-page GitHub activity tracker for [mcharo](https://github.com/mcharo). It's a
Jekyll site; the page itself loads data from the public GitHub API in the browser.
Pushes to `master` build and deploy it with GitHub Actions
(`.github/workflows/pages.yml`).

## Preview locally

With Docker, so gems (and any native extensions they compile) stay in a container:

```sh
docker run --rm -it -p 4000:4000 -v "$PWD":/site -w /site \
  -v mcharo-site-bundle:/usr/local/bundle -e BUNDLE_FROZEN=true \
  ruby:"$(cat .ruby-version)" \
  sh -c 'bundle install && bundle exec jekyll serve --host 0.0.0.0'
```

Then open http://localhost:4000.

## Dependency safeguards

- **Release cooldown.** The Gemfile's `cooldown: 7` stops Bundler (4.0.13+) from
  picking any gem version published less than 7 days ago. Dependabot uses the same
  7-day cooldown for gems and GitHub Actions.
- **Checksums.** `Gemfile.lock` records a SHA-256 for every gem, and Bundler refuses
  to install a gem that doesn't match.
- **Frozen installs.** CI sets `BUNDLE_FROZEN=true`, so the build fails rather
  than quietly changing `Gemfile.lock`.
- **Pinned actions.** Workflow actions are pinned to commit SHAs.
- **Small dependency tree.** Jekyll alone, with no theme or plugin gems.

To update gems, run `bundle update` (without `BUNDLE_FROZEN`) in the container
above. It picks the newest versions that are at least 7 days old.
