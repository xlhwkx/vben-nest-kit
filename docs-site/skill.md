# 智能体二开 Skill

另一 agent **只靠 skill + 仓内文档**即可少踩合同与门禁坑。

## 入口

- 仓内完整版：[`skills/qingzhan-backend/SKILL.md`](https://github.com/xlhwkx/vben-nest-kit/blob/main/skills/qingzhan-backend/SKILL.md)
- 真源合同：[`规则/api-contract-vben.md`](https://github.com/xlhwkx/vben-nest-kit/blob/main/规则/api-contract-vben.md) · [技术方案](https://github.com/xlhwkx/vben-nest-kit/blob/main/规则/vben-nestjs-backend-tech-plan.md)

## Agent 最小启动（摘要）

1. 通读合同 + 技术方案（冲突以合同为准）。
2. 扫 `docs/qingzhan/architecture.md`；运维再看 deploy / backup / observability。
3. 落点：`apps/server`（Nest）、联调 `apps/admin`；勿改无关 app。
4. 定小切片与验收点（路径 / 信封 / refresh 例外 / 无 password）。
5. 本地：`docker compose up -d` → Nest `:5320` → 可选 `pnpm dev:antd` `:5666` → health。
6. 提审材料含 **skill 路径**、改动文件、合同对照、探活/测试。

## 硬约束速查

| 项 | 值 |
| --- | --- |
| 信封 | `{ code, data, error, message }`，成功 `code === 0` |
| refresh | `POST /api/auth/refresh` → **纯 accessToken 字符串** |
| Cookie | refresh 名 **`jwt`** |
| 禁止 | 响应体返回 **password** |
| Public / Release | **须用户明确点头**；发版 workflow 默认禁用 |

English: [/en/skill](/en/skill)
