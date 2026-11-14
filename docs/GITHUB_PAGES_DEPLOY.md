# GitHub Pages deploy workflow

Workflow: `.github/workflows/deploy-pages.yml` (job name `deploy`).

## Why `deploy` was red on clean-main

CI failed at **configure-pages** with:

`Get Pages site failed ... Error: Not Found` — GitHub Pages was not enabled for this repository (source must be **GitHub Actions**).

That is a repository setting Jordan controls, not an application bug.

## What we changed in code

`actions/configure-pages@v6` now passes `enablement: true`, which can auto-enable Pages when org policy allows it.

## If the job still fails after merge

In GitHub: **Settings → Pages → Build and deployment → Source: GitHub Actions** (enable Pages for the repo).

**Paste back:** a screenshot or the text “Pages enabled, last deploy workflow green.”

## What Pages hosts

Static `docs/` only (mobile ops shell). Backend and secrets stay on Frank; the page still asks for API URL + token in settings.
