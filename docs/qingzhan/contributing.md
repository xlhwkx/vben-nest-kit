# 青栈贡献指南

> English: [contributing.en.md](./contributing.en.md)

## 改接口前先读合同

1. `规则/api-contract-vben.md` — 路径、方法、信封、Cookie `jwt`、Bearer、refresh 纯字符串例外、禁止响应 password。
2. `规则/vben-nestjs-backend-tech-plan.md` — 选型与里程碑。

口头约定**不能**覆盖合同。需要改合同字段时，先改 `规则/` 再改代码，并在 PR 说明。

架构摘要： [architecture.md](./architecture.md)。

## 分支与 PR

- 从最新 `main` 拉分支；小步提交，一条逻辑一刀更易审。
- PR 说明：改了哪些路径/模块、如何自测、是否动到合同。
- **不要** force-push 共享分支；**不要**提交 `.env`、密钥、`uploads/` 用户文件、本机日志。
- 开源贡献者按 PR checklist 自检；本团队另有结对群审（开发切片 → 审查放行），不替代 CI / 合同。

## 本地环境

```bash
cp .env.example .env
docker compose up -d
```

默认宿主端口：Postgres **55433**、Redis **56379**、Nest **5320**（见 `.env.example`）。

### 安装依赖

优先仓库根：

```bash
pnpm install --frozen-lockfile
pnpm --filter @qingzhan/server start:dev
```

仅开发后端时可在根目录使用 workspace filter，仍保留根锁文件与构建白名单：

```bash
IGNORE_STUB=1 pnpm install --frozen-lockfile --filter @qingzhan/server...
pnpm --filter @qingzhan/server exec prisma migrate deploy
ALLOW_DEMO_SEED=true pnpm --filter @qingzhan/server exec prisma db seed
pnpm --filter @qingzhan/server start:dev
```

`apps/server/pnpm-lock.yaml` 已 gitignore；workspace 场景以根 lock 为准。

### E2E

```bash
cd apps/server
pnpm test:e2e
```

需要 Compose + `.env` + seed。Node engines：`^22.18 || ^24.12`（脚本含 `--experimental-vm-modules`）。详见 `apps/server/README.md`。

### 前端联调

已配置 `VITE_NITRO_MOCK=false`、`accessMode: 'backend'`、proxy → Nest。改 preferences 后清 localStorage。

完整管理页面使用 `pnpm dev:admin`（playground，http://localhost:5555）；web-antd 示例使用 `pnpm dev:antd`（http://localhost:5666）。干净机器须根目录 `pnpm install --frozen-lockfile`（含 postinstall stub）。若 `@vben/vite-config` 解析失败，完成安装后执行 `pnpm -r run --if-present stub`。根 README 提供从配置、迁移到 seed 的主路径；质量命令与运行验收见[生产验收指南](./production-acceptance.md)。

## 安全与卫生

- 切勿提交 `.env`、真实 JWT 密钥、生产连接串。
- 上传目录与演示产物保持 gitignore。
- 响应与审计明细不得泄漏 password / refresh token 明文。
- 破坏性操作（删库、force-push、改生产密钥）先征得维护者同意。

## 建议的自检清单

- [ ] 双前缀 `/api` 与 `/api/v1` 仍可用
- [ ] 信封 `code === 0`；refresh 仍为纯字符串
- [ ] 无 password 泄漏；鉴权 / 权限码符合预期
- [ ] `pnpm test:e2e`（或相关单测）通过
- [ ] 未误改无关上游 Vben 文件；文档未引入损坏的代码围栏转义
