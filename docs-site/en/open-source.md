# Open-source checklist

Full checklist: [`docs/qingzhan/open-source-checklist.md`](https://github.com/xlhwkx/vben-nest-kit/blob/main/docs/qingzhan/open-source-checklist.md).

## Docs site

- This site lives in `docs-site/` (VitePress).
- **Enable GitHub Pages after the repo is Public** (Settings → Pages → GitHub Actions); workflow: `.github/workflows/qingzhan-pages.yml`.
- In-repo `docs/qingzhan/` + README are enough for first public release; **the site is not a hard gate**.

## Bot boundaries

- Do not flip Public or cut a Release without explicit user OK.
- Secret scans / key rotation are checklist **B** items for humans.
