# 青栈文档站（docs-site）

独立 VitePress 站点，与上游 Vben `docs/`（`@vben/docs`）分离；正文通过 `@include` 复用 `docs/qingzhan/*` 与 `skills/qingzhan-backend/SKILL.md`。

## 本地

在仓库根：

```bash
pnpm install
pnpm docs:dev      # http://localhost:5173/vben-nest-kit/
pnpm docs:build    # 输出 docs-site/.vitepress/dist
```

仅本包：

```bash
pnpm --filter @qingzhan/docs-site dev
pnpm --filter @qingzhan/docs-site build
```

本地若要以 `/` 为 base 预览，可设 `QINGZHAN_DOCS_BASE=/`。

## GitHub Pages（免费）

1. 仓库改为 **Public**（免费 Pages 对公仓；私有仓 Pages 需付费计划）。
2. Settings → Pages → Source: **GitHub Actions**。
3. Workflow：`.github/workflows/qingzhan-pages.yml`（push `main` 且改动 `docs-site/**` / `docs/qingzhan/**` / skill 时构建；亦可 `workflow_dispatch`）。
4. 站点地址预期：`https://xlhwkx.github.io/vben-nest-kit/`。

**注意：** 未 Public 前不要依赖对外 URL；构建可在私有仓跑通，访客访问需 Public（或付费私有 Pages）。

## Logo

- `docs-site/public/logo.svg`（站内 / favicon）
- 副本：`docs/qingzhan/logo.svg`（README 可用）

原创几何「栈」层叠标记，无第三方素材。

## 无密钥

本站仅静态文档；禁止写入 `.env`、JWT、密码或云密钥。
