# Mock vs Nest field parity (Qingzhan)

> Sources: `apps/backend-mock/**` + `规则/api-contract-vben.md`
> Nest: `apps/server/**`
> Date: 2026-11-02 (Asia/Singapore)
> This slice fixes: CST Asia/Shanghai list day-bound; playground user roles multi-select; create password >=6 UI

## Summary

| Area | Verdict | Notes |
|------|---------|-------|
| Envelope / paging | OK | `code/data/error/message`; page `data.items` + `data.total` |
| Auth P0 | OK | login no password; refresh raw string; logout `data:""`; codes `string[]` |
| user/info + menu/all | OK | BasicUserInfo `roles` (codes); menu tree excludes buttons |
| dict runtime | OK | `/dict/all|data|version` shapes match mock |
| system CRUD list | OK | Nest supersets (`code`/`username`/`roles`); **createTime ISO** |
| demo P2 | OK | table/status/timezone/bigint |
| **Fixed this slice** | user write + time + naming | see below |
| Remaining gaps | last section | CI builds / captcha / mail / public |

---

## Path / field diffs

### P0 auth / session

| Path | Mock `data` keys | Nest | Diff |
|------|------------------|------|------|
| `POST /auth/login` | `id,password,realName,roles,username,homePath,accessToken` | `id,userId,username,realName,roles,homePath,accessToken` (no password) | Intentional: contract Must forbid password; extra `userId` OK |
| `POST /auth/refresh` | raw accessToken string | same + refresh rotation | OK |
| `POST /auth/logout` | `""` | `""` | OK |
| `GET /auth/codes` | `string[]` | `string[]` (DB codes) | values differ from mock demos; shape OK |
| `GET /user/info` | `id,realName,roles,username,homePath` | +`userId,avatar,desc` | **`roles` = role codes** (contract BasicUserInfo). Not menu permissions. |
| `GET /menu/all` | RouteRecord tree | DB role menu tree (no button) | shape OK; content follows seed |

### P1 system admin

| Path | Mock | Nest | Diff / status |
|------|------|------|---------------|
| `GET /system/user/list` | items: `id,name,status,gender,createTime,deptId?,remark?` | +`username,roles` (roleId[]); **createTime ISO-8601 UTC** | superset OK |
| `POST /system/user` | mock middleware 403 | Must `username`+`password`+`name` (≥6); response **never** password | **Fixed**: playground form now collects username/password |
| `PUT /system/user/:id` | 403 | partial; password optional (omit/empty = keep hash) | OK |
| `GET /system/role/list` | items: `id,name,status,createTime,permissions[],remark?` | +`code`; `permissions`=menu id[]; createTime ISO | OK |
| `POST /system/role` | 403 | name required; code optional (auto-slug) | OK (prior slice) |
| `PUT /system/role/:id` | 403 | partial update (incl. `{status}`) | OK (prior slice) |
| `GET /system/dept/list` | tree; root `pid:0` | same; createTime ISO | OK |
| `GET /system/menu/list` | admin tree with button/`authCode`/`pid` | same shape (UUID ids) | OK |
| `GET /system/dict/type|data/list` | `items+total` + createTime | same; createTime ISO | OK |
| list `startTime/endTime` | string compare vs mock createTime | Date filter; **YYYY-MM-DD = Asia/Shanghai day** (start 00:00 / end 23:59:59.999 +08) | **Fixed** |

### P1/P2 other

| Path | Verdict |
|------|---------|
| `POST /upload` | `data.url` OK (real store vs mock fixed URL) |
| `GET /table/list` | field names aligned; stable fake data |
| `GET /status` | error envelope OK |
| timezone / bigint | aligned with contract §8 |
| `/api/test` | Nest skips; use health (documented) |

---

## Fixed this slice

1. **List day-bound → Asia/Shanghai**: `YYYY-MM-DD` `startTime`/`endTime` map to Shanghai calendar day start/end (`+08:00`), matching RangePicker. Full ISO strings still pass through.
2. **Playground system/user roles multi-select**: form `ApiSelect` `mode: multiple` loads `/system/role/list` (`resultField: items`) and posts `roles: string[]` (role ids) to Nest.
3. **Create/edit password ≥6**: playground zod `min(6)` (+ edit refine); Nest zod/service already enforced.
4. Prior slice still holds: username+password create, ISO `createTime`, `roles` vs `permissions` naming.

---

## Remaining gaps (next candidates)

| Priority | Item | Suggestion |
|----------|------|------------|
| P2 | CI drop `dangerouslyAllowAllBuilds` | **done**: root `allowBuilds` + `pnpm install --filter @qingzhan/server...` |
| Later | SliderCaptcha UI E2E, real mail, public repo/Release | wait for user approval |

Repo visibility unchanged; no Release cut.
