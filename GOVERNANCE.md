# Governance

## Project maintainer

HYDI System v2 is maintained by **[@waveformer1984](https://github.com/waveformer1984)**. The maintainer has final authority over all technical decisions, roadmap priorities, and release timing.

Contact: waveformer1984@gmail.com

## Decision-making

All decisions — architecture changes, dependency upgrades, breaking changes, and release scheduling — are made by the maintainer. There is no committee or voting process at this stage of the project.

Community members may propose changes via GitHub Issues or pull requests. Proposals are evaluated against the following criteria:

1. Does it preserve the six-layer pipeline contract (no layer performing another's job)?
2. Does it maintain the immutability and determinism of the RAW EVENT LEDGER?
3. Does KILO remain hypothesis-only (no execution authority)?
4. Does the PolicyEngine remain fail-closed (default `'reject'`)?
5. Does it comply with the DB migration governance gate?

Proposals that violate any of these constraints will be rejected regardless of other merits.

## Contribution process

1. Open a GitHub Issue describing the change before writing code.
2. Fork the repository and develop on a feature branch.
3. All PRs must target the `clean-main` branch.
4. The PR checklist (see [CONTRIBUTING.md](CONTRIBUTING.md)) must be satisfied before review.
5. Every new `.sql` migration requires a corresponding test in `tests/migrations/<version>.test.js`.
6. State machine changes require `STATE_MACHINE_APPROVED` in the PR description.
7. The maintainer reviews and merges accepted PRs.

## Becoming a maintainer

There are currently no plans to expand the maintainer team. If the project grows to the point where additional maintainers are needed, candidates will be selected from consistent contributors who demonstrate deep understanding of the pipeline architecture and a track record of high-quality PRs.

## Breaking changes

Breaking changes to the pipeline API, Supabase schema, or worker interfaces require:

- A GitHub Issue opened at least one week before the PR is submitted
- Clear documentation of the migration path in the PR description
- Updated tests covering the changed behaviour

## Releases

Releases are tagged by the maintainer when a meaningful set of changes has accumulated. There is no fixed release cadence. Version numbers follow [Semantic Versioning](https://semver.org/).

## Amendments to this document

Changes to this governance document require a PR with a clear rationale. The maintainer has final approval.
