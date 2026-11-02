# @qingzhan/server

青栈 NestJS 12 后端。契约见仓库根目录 `规则/`。

```bash
pnpm install          # 建议在 monorepo 根执行
pnpm start:dev        # 默认端口 5320
pnpm build
```

健康检查：`GET /api/health`、`GET /api/v1/health`（信封 `{ code, data, error, message }`）。
