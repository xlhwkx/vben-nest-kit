---
name: qingzhan-backend
description: 在扩展或二开青栈（vben-nest-kit）Nest 后端、新增域模块/API、联调 admin、对照合同做切片验收、部署/备份/开源清单 B 项时使用。智能体二开青栈专用 skill。
---

# 青栈二开（智能体专用）

另一 agent **只靠本 skill + 仓内文档**即可少踩合同与门禁坑。口头约定一律不敌真源。  
仓内路径：`skills/qingzhan-backend/SKILL.md`（提审材料须写明此路径）。

## 0. Agent 最小启动步骤

接到二开 / 改接口 / 联调 / 部署 / 开源相关任务时，**按序做完再写代码**：

1. 打开并通读（或检索相关章）`规则/api-contract-vben.md` + `规则/vben-nestjs-backend-tech-plan.md`；冲突以合同为准。
2. 扫一眼 `docs/qingzhan/architecture.md` 确认模块地图与本地端口；运维类再打开 `docs/qingzhan/deploy.md` / `backup-migrate.md` / `observability.md`。
3. 确认落点：`apps/server`（Nest）、联调 `apps/admin`；不要改无关 app。
4. 定**小切片**范围（一组接口或一个域模块）与验收点（路径/信封/`refresh` 例外/无 password）。
5. 本地能跑则：`docker compose up -d` → Nest `:5320` → 必要时 `pnpm dev:antd` `:5666` → `GET /api/health/live|ready`。
6. 实现后跑本切片测试；维护方有审查门禁则提审，材料含：**本 skill 路径**、改动文件、合同对照结论、探活/测试结果。

跳过第 1–2 步直接改代码 = 违规。

## 1. 栈与合同硬约束（默认不要改）

| 项 | 值 |
| --- | --- |
| 运行时 | Nest 12 + Express（`apps/server`） |
| 数据 | Prisma 7 + PostgreSQL 16 |
| 缓存 | Redis 7 |
| 鉴权 | Bearer access + HttpOnly Cookie 名 **`jwt`**（refresh）；密码 **Argon2id** |
| 权限 | RBAC；前端 `accessMode: backend` |
| 信封 | `{ code, data, error, message }`，成功 **`code === 0`** |
| 例外 | `POST /api/auth/refresh` → **纯 accessToken 字符串**（无信封） |
| 前缀 | 兼容别名 `/api/*` + 版本 `/api/v1/*`（同处理器） |
| 禁止 | 响应体返回 **password**（mock quirk 勿照抄） |

改路径 / 信封 / Cookie / 登录字段：先改合同或注明偏离并同步前端。

## 2. 代码落点

- Nest 域模块：`apps/server`（Controller → Service → Prisma；仿 Auth/User/Menu/System/Upload/Health/Audit）。
- 前端联调：`apps/admin`（`VITE_NITRO_MOCK=false`，代理 `/api` → Nest `:5320`）。
- API 对账：以 `规则/api-contract-vben.md` 和后端实际实现为准；旧 mock 对照报告仅为历史参考。
- 运维文档：`docs/qingzhan/`。
- 产品文档站：`docs-site/`（VitePress；`pnpm docs:dev`；Pages 须 Public 后启用，非开源硬门槛）。

## 3. 本地验证

默认宿主口（`.env.example` / contributing）：Postgres **55433**、Redis **56379**、Nest **5320**、admin **5555**。

1. 根目录 `pnpm install`（含 stub）；`docker compose up -d`。
2. 起 Nest + 可选 `pnpm dev:antd`。
3. 探活 `/api/health/live`、`/ready`；可选 `/api/health/metrics`。
4. 本切片 e2e/单测；登录冒烟 `vben`/`123456`（Captcha 旁路仅开发/E2E，见 architecture）。
5. 负载冒烟：`docs/qingzhan/deploy.md` → `pnpm test:load:smoke`。

## 4. 切片与提审

1. 一小片一提交；对照合同核路径、HTTP 码、信封、`refresh`、Cookie `jwt`、无 password、双前缀。
2. 提小 PR / 可审提交。**维护方若启用审查门禁**：提审材料必须包含  
   - skill 路径：`skills/qingzhan-backend/SKILL.md`  
   - 切片说明 + 合同对照 + 测试/探活结果  
   阻断项清零后再合。Fork 用户按自有流程即可。
3. 不顺手改无关包；跳过文档约定须在 PR 写明。

## 5. 安全（Must）

- `auth:fail` / 登录 throttler：Redis 故障 **fail-closed**（见 architecture）。
- 上传：MIME 白名单 + **magic-bytes**；默认无 SVG；对齐 `UPLOAD_MAX_BYTES`。
- `.env` / `.env.production` / `uploads/` 已 ignore；禁止提交真密钥。
- CORS 带 Credentials 时 Origin 不能是 `*`；生产 JWT ≥32、禁 `CAPTCHA_E2E_BYPASS`。

## 6. 骨架未交付（勿发明生产厂商）

勿写成已交付：真 SMTP/独立 worker、真 S3 运维一键、真滑块厂商 SDK、OAuth/多租户、Playwright 整页 E2E。  
接真服务须默认关 env，并更新 `docs/qingzhan/` 与开源清单「已知缺口」。

## 7. 部署 / 备份 / 可观测

- `docs/qingzhan/deploy.md` + `compose.prod.yml`
- `docs/qingzhan/backup-migrate.md`（`backups/`、`*.dump` 勿入库）
- `docs/qingzhan/observability.md`

## 8. 开源清单 B 项（人工；智能体只协助）

见 `docs/qingzhan/open-source-checklist.md`：

1. 轮换密钥；确认历史无真 `JWT_*` / Redis / 云密钥。
2. 按清单跑敏感 `git grep`；结果给人看。
3. CI badge（仅访客可见检查）、Vben 归属（`README.vben.md`）可发现。
4. **Public** 与 **GitHub Release**：须用户明确说「改 Public」「打 Release / 发 vX.Y.Z」；禁止擅自改可见性或 `gh release create`；`qingzhan-release.yml` 默认保持禁用逻辑。
5. **官网 / VitePress**：独立站为另刀；GitHub Pages 须 Public 后启用。仓内 `docs/qingzhan/` 已够首发，**官网不是开源硬门槛**。

顺序：勾完 B 敏感项 → Public → Release（官网可并行起草，不挡 B/Public）。

## 9. 验收自检

- [ ] 合同路径/方法/信封/`refresh`/Cookie `jwt` 对齐；无 password
- [ ] 鉴权失败码符合合同；双前缀可用
- [ ] 探活 + 本切片测试通过
- [ ] 无密钥落盘；骨架未谎称生产交付
- [ ] 提审材料含 `skills/qingzhan-backend/SKILL.md`（若走维护方门禁）