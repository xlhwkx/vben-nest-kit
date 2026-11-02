# Mock vs Nest field parity (Qingzhan)

> Sources: `apps/backend-mock/**` + `规则/api-contract-vben.md`
> Nest: `apps/server/**`
> Date: 2026-11-02 (Asia/Singapore)
> This slice fixes: `system/role` partial PUT / optional code; list `endTime` day-bound

## Summary

| Area | Verdict | Notes |
|------|---------|-------|
| Envelope / paging | OK | `code/data/error/message`; page `data.items` + `data.total` |
| Auth P0 | OK | login no password; refresh raw string; logout `data:""`; codes `string[]` |
| user/info + menu/all | OK | BasicUserInfo required fields; menu tree excludes buttons |
| dict runtime | OK | `/dict/all|data|version` shapes match mock |
| system CRUD list | Mostly OK | Nest supersets (`code`/`username`/`roles`) |
| demo P2 | OK | table/status/timezone/bigint |
| **Fixed this slice** | role write path | see below |
| Remaining gaps | last section | next-slice candidates |

---

## Path / field diffs

### P0 auth / session

| Path | Mock `data` keys | Nest | Diff |
|------|------------------|------|------|
| `POST /auth/login` | `id,password,realName,roles,username,homePath,accessToken` | `id,userId,username,realName,roles,homePath,accessToken` (no password) | Intentional: contract Must forbid password; extra `userId` OK |
| `POST /auth/refresh` | raw accessToken string | same + refresh rotation | OK |
| `POST /auth/logout` | `""` | `""` | OK |
| `GET /auth/codes` | `string[]` | `string[]` (DB codes) | values differ from mock demos; shape OK |
| `GET /user/info` | `id,realName,roles,username,homePath` | +`userId,avatar,desc` | matches BasicUserInfo; no password |
| `GET /menu/all` | RouteRecord tree | DB role menu tree (no button) | shape OK; content follows seed |

### P1 system admin

| Path | Mock | Nest | Diff / status |
|------|------|------|---------------|
| `GET /system/user/list` | items: `id,name,status,gender,createTime,deptId?,remark?` | +`username,roles` (roleId[]) | superset OK; paging OK |
| `POST/PUT /system/user` | mock middleware 403 | real write; create needs `username+password+name` | **Remaining**: playground form lacks username/password -> create still 400 (frontend) |
| `PUT /system/user/:id` `{status}` | — | partial update already supported | OK |
| `GET /system/role/list` | items: `id,name,status,createTime,permissions[],remark?` | +`code`; `permissions`=menu id[] | superset OK |
| `POST /system/role` | 403 | name required; **code optional** (auto-slug) | **Fixed this slice** |
| `PUT /system/role/:id` | 403 | **partial update** (incl. `{status}` only) | **Fixed this slice** (UI status toggle was broken) |
| `GET /system/dept/list` | tree; root `pid:0` | same | OK |
| `GET /system/menu/list` | admin tree with button/`authCode`/`pid` | same shape (UUID ids) | OK |
| `GET /system/dict/type|data/list` | `items+total` + createTime | same | OK |
| list `startTime/endTime` | string compare vs mock createTime | Date filter; **YYYY-MM-DD end includes that UTC day** | **Fixed this slice** (user/role) |

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

1. **`PUT /api/system/role/:id`**: all body fields optional (at least one); matches playground `updateRole(id, { status })`.
2. **`POST /api/system/role`**: `code` optional; slug from `name` when omitted (suffix on conflict).
3. **`parseListCreatedAtRange`**: user/role list treats `YYYY-MM-DD` `endTime` as `23:59:59.999Z` that day.

---

## Remaining gaps (next candidates)

| Priority | Item | Suggestion |
|----------|------|------------|
| P1 | system/user **create** missing username/password | add frontend fields; or Nest demo auto-username (needs product call) |
| P1 | playground SystemUser type says `permissions`; Nest returns `roles` | align frontend type / docs |
| P2 | `createTime` still zh-CN string | contract Should -> ISO-8601 UTC (or dual fields) |
| P2 | CI drop `dangerouslyAllowAllBuilds` | whitelist only |
| Later | SliderCaptcha UI E2E, real mail, public repo/Release | wait for user approval |

Repo visibility unchanged; no Release cut.