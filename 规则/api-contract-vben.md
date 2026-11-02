# Vben Admin × NestJS 路径级 API 合同

> **项目**：vben-nest-kit（青栈）


> **版本**：1.0.0  
> **日期**：2026-11-02（Asia/Singapore）  
> **真源**：[`vbenjs/vue-vben-admin` `main`](https://github.com/vbenjs/vue-vben-admin) → `apps/backend-mock/**` + `apps/web-antd/src/api/**`  
> **配套**：`vben-nestjs-backend-tech-plan.md` v1.2（选型与理由）  
> **用途**：Nest 实现时按本表对齐路径/方法/信封/字段；联调以本表为准，不以口头约定为准。

---

## 0. 怎么读这份合同

| 标记 | 含义 |
|------|------|
| **Must** | Nest 必须与 Vben 前端默认行为兼容，改了前端会挂 |
| **Should** | 推荐实现；偏离需在 PR 注明并改前端或加适配层 |
| **Mock quirk** | 官方 mock 的怪异行为；Nest **不要照抄缺陷**，但要保证前端仍能工作 |
| **Nest only** | 技术方案扩展（`/api/v1`、健康探针等），前端默认可不调用 |

路径一律写**浏览器侧看到的完整路径**（含 `/api` 前缀）。  
Vben 开发代理：`/api` → `http://localhost:5320/api`（rewrite 去掉再拼回 `/api`）。  
前端 `requestClient` 的 `baseURL` = `VITE_GLOB_API_URL`（开发默认 `/api`），业务代码里写的是**相对路径**如 `/auth/login`。

---

## 1. 统一响应信封（Must）

真源：`apps/backend-mock/utils/response.ts`  
前端解包：`apps/web-antd/src/api/request.ts` → `defaultResponseInterceptor({ codeField: 'code', dataField: 'data', successCode: 0 })`，且 `responseReturn: 'data'`。

### 1.1 成功（非分页）

```json
{
  "code": 0,
  "data": {},
  "error": null,
  "message": "ok"
}
```

- `code === 0` 才算成功（Must）。
- `requestClient` 调用方拿到的已经是 **`data` 本体**，不是整包。
- `error` 字段 mock 有；Nest Should 保留（可为 `null`），便于错误拦截器读 `error ?? message`。

### 1.2 成功（分页）

真源：`usePageResponseSuccess` → `data: { items, total }`，`total` 为**过滤后全量条数**（不是当前页条数）。

```json
{
  "code": 0,
  "data": {
    "items": [],
    "total": 100
  },
  "error": null,
  "message": "ok"
}
```

分页 Query（列表类 Must）：

| 参数 | 类型 | 默认 | 说明 |
|------|------|------|------|
| `page` | number/string | `1` | 从 1 开始 |
| `pageSize` | number/string | 视接口（常 `20`；table 默认 `10`） | Nest Should 上限 100 |

### 1.3 业务失败（信封内）

```json
{
  "code": -1,
  "data": null,
  "error": "…",
  "message": "…"
}
```

### 1.4 HTTP 状态码（与 mock 对齐）

| 场景 | HTTP | body |
|------|------|------|
| 参数缺失（如 login 缺字段） | 400 | `{ code: -1, … }` |
| 未登录 / access 无效 | **401** | `unAuthorizedResponse` |
| 账号密码错误 / refresh 失败 | **403** | `forbiddenResponse` |
| 演示环境禁止写（mock 中间件） | 403 | 仅 mock；Nest 不复刻 |

### 1.5 唯一例外：`POST /api/auth/refresh`（Must 兼容）

**Mock quirk**：该接口**直接返回 accessToken 字符串**，**不**包 `{ code, data }`。

前端用的是 **`baseRequestClient`**（无信封解包），逻辑：

```ts
const resp = await refreshTokenApi();
const newToken = resp.data; // axios 的 response.data = 纯字符串
```

Nest **Must** 二选一：

1. **兼容 mock**：HTTP 200，`Content-Type: text/plain` 或 JSON string，body 为 accessToken 原文；或  
2. **更干净**：返回 `{ code: 0, data: "<token>", … }`，同时改前端 `doRefreshToken` / `RefreshTokenResult`（需同步改前端，不单改后端）。

**v0.1 建议**：选项 1，零前端改动。合同下文按选项 1 描述。

---

## 2. 鉴权与 Cookie（Must）

### 2.1 Access Token

| 项 | 值 |
|----|----|
| 传递 | 请求头 `Authorization: Bearer <accessToken>` |
| 前端写入 | `login` / `refresh` 成功后 `accessStore.setAccessToken` |
| Mock 签发 | JWT，secret=`access_token_secret`，`expiresIn: '7d'`（**仅 mock**；Nest 按技术方案用短 TTL + 真密钥） |
| 校验失败 | HTTP 401 + 信封错误 |

### 2.2 Refresh Token Cookie

真源：`apps/backend-mock/utils/cookie-utils.ts`

| 项 | Mock 实际值 | Nest 合同 |
|----|-------------|-----------|
| Cookie 名 | **`jwt`** | Must 名 `jwt`（或网关改写；改名必须改前端/`withCredentials` 约定） |
| 内容 | refresh JWT | opaque / JWT + 服务端会话索引均可 |
| `httpOnly` | `true` | Must |
| `secure` | `true` | Must（本地 HTTPS 或 Trusted proxy；纯 HTTP 本地可用环境变量放宽并文档注明） |
| `sameSite` | `none` | 跨站前端 Must `none`；同站可 `lax`（写进 env） |
| `maxAge` | 86400（24h） | Should 与 refresh TTL 一致（技术方案可更长） |
| 发送 | `withCredentials: true`（refresh/logout） | Must CORS `Access-Control-Allow-Credentials: true`，且 `Allow-Origin` **不能是 `*`**（须回显具体 Origin） |

### 2.3 CORS（Must，跨域时）

对齐 mock `middleware/1.api.ts` + `nitro.config.ts` 精神：

- 回显 `Origin`
- `Access-Control-Allow-Credentials: true`
- 允许头含 `Authorization, Content-Type, Accept-Language, …`
- `OPTIONS` → 204

Nest：`trust proxy` 在反代后 Must 打开（见技术方案）。

---

## 3. 路径版本策略（Nest only + 兼容）

| 前缀 | 用途 |
|------|------|
| `/api/auth/*`、`/api/user/*`、`/api/menu/*`、`/api/system/*`、`/api/dict/*`、`/api/upload` … | **Vben 兼容别名（Must 在 v0.x 提供）** |
| `/api/v1/...` | 正式版本化资源（技术方案第 28 章）；可与上表同处理器 |

下文路径均写 **兼容别名**（前端默认调用的那些）。

---

## 4. 核心鉴权与会话（P0，Must 先实现）

### 4.1 `POST /api/auth/login`

| | |
|--|--|
| 认证 | 无 |
| Content-Type | `application/json` |
| 前端 | `loginApi` → `requestClient.post('/auth/login', data)` |

**Request**

```json
{
  "username": "vben",
  "password": "123456"
}
```

| 字段 | 必填 | 说明 |
|------|------|------|
| `username` | 是 | |
| `password` | 是 | |

缺任一字段 → HTTP 400 + `{ code: -1, message: "BadRequestException", error: "Username and password are required" }`（message/error 文案可本地化，结构 Must）。

**Response `data`（mock 实际）**

```json
{
  "id": 0,
  "password": "123456",
  "realName": "Vben",
  "roles": ["super"],
  "username": "vben",
  "homePath": "/dashboard/workspace",
  "accessToken": "<jwt>"
}
```

**Mock quirk**：登录 `data` 含 **`password` 明文**。Nest **Must 禁止返回 password**。

**Nest Should 返回的 `data`（兼容前端）**

前端登录只解构 `accessToken`；用户资料另调 `/user/info`。因此 login 的 `data` **至少**含：

```json
{
  "accessToken": "<jwt>"
}
```

可附带用户摘要（不含密码），不强制。

**副作用**：Set-Cookie `jwt=<refresh>`（见 §2.2）。失败时清 cookie。

**Demo 账号（seed，非合同硬约束）**

| username | password | roles | homePath |
|----------|----------|-------|----------|
| `vben` | `123456` | `["super"]` | `/dashboard/workspace` |
| `admin` | `123456` | `["admin"]` | `/dashboard/workspace` |
| `jack` | `123456` | `["user"]` | `/dashboard/analytics` |

密码错误 → HTTP 403，文案类似 `Username or password is incorrect.`

---

### 4.2 `POST /api/auth/refresh`

| | |
|--|--|
| 认证 | Cookie `jwt`（无 Bearer 要求） |
| 前端 | `baseRequestClient.post('/auth/refresh', undefined, { withCredentials: true })` |

**Request body**：无。

**Response（兼容模式 Must）**

- HTTP 200
- Body = **accessToken 字符串**（非信封）
- 重新 Set-Cookie `jwt`（mock 会先 clear 再 set 同一个 refresh；Nest Should 旋转 refresh：旧 jti 作废、发新 cookie）

失败（无 cookie / 无效 / 用户不存在）→ HTTP 403 + 错误信封。

---

### 4.3 `POST /api/auth/logout`

| | |
|--|--|
| 认证 | Cookie 可选 |
| 前端 | `baseRequestClient.post('/auth/logout', …, { withCredentials: true })` |

**Response**

```json
{ "code": 0, "data": "", "error": null, "message": "ok" }
```

副作用：清除 `jwt` cookie；Nest Should 吊销服务端 refresh 会话。

---

### 4.4 `GET /api/auth/codes`

| | |
|--|--|
| 认证 | Bearer Must |
| 前端 | `getAccessCodesApi` → `string[]` |

**Response `data`**：权限码字符串数组，例如：

```json
["AC_100100", "AC_100110", "AC_100120", "AC_100010"]
```

无码时 `[]`。用于按钮级权限（`accessCodes`）。

---

### 4.5 `GET /api/user/info`

| | |
|--|--|
| 认证 | Bearer Must |
| 前端 | `getUserInfoApi` → `@vben/types` `UserInfo` |

**Mock 实际 `data`**（access JWT 解出用户后去掉 password）：

```json
{
  "id": 0,
  "realName": "Vben",
  "roles": ["super"],
  "username": "vben",
  "homePath": "/dashboard/workspace"
}
```

**前端类型期望**（`BasicUserInfo` + 扩展；有 `[key: string]: any`）：

| 字段 | 前端类型 | Nest |
|------|----------|------|
| `username` | string | Must |
| `realName` | string | Must |
| `roles` | `string[]` | Must（驱动路由权限） |
| `homePath` | string | Should |
| `userId` | string | Should（可用 UUID；可同时保留 `id` 兼容） |
| `avatar` | string | Should（可空字符串） |
| `desc` | string | Should |
| `token` | string | **不要**再塞 accessToken；前端类型有此字段但是历史包袱 |

**禁止**：返回 `password`。

---

### 4.6 `GET /api/menu/all`

| | |
|--|--|
| 认证 | Bearer Must |
| 前端 | `getAllMenusApi` → `RouteRecordStringComponent[]` |
| 模式 | `accessMode: backend` 时由此生成动态路由 |

**Response `data`**：菜单树数组。节点形状（mock）：

```json
{
  "name": "Dashboard",
  "path": "/dashboard",
  "redirect": "/dashboard/analytics",
  "meta": {
    "order": -1,
    "title": "page.dashboard.title"
  },
  "children": [
    {
      "name": "Analytics",
      "path": "analytics",
      "component": "/dashboard/analytics/index",
      "meta": {
        "affixTab": true,
        "title": "page.dashboard.analytics"
      }
    }
  ]
}
```

| 字段 | 说明 |
|------|------|
| `name` | 路由 name，Must 唯一 |
| `path` | 路由 path |
| `component` | 字符串组件路径（前端映射视图）；外链/内嵌可用 `IFrameView` 等 |
| `redirect` | 可选 |
| `meta.title` | i18n key 或文案 |
| `meta.authority` | 可选角色数组 |
| `meta.icon` / `order` / `affixTab` / `keepAlive` / `menuVisibleWithForbidden` … | 按 Vben 路由 meta 约定 |

按当前用户 roles/权限过滤后返回；无菜单时 `[]`。

---

## 5. 上传（P1）

### 5.1 `POST /api/upload`

| | |
|--|--|
| 认证 | Bearer Must |
| 前端 | multipart（见 `upload.ts` 应用侧） |

**Mock Response `data`**

```json
{ "url": "https://unpkg.com/@vbenjs/static-source@0.1.7/source/logo-v1.webp" }
```

Nest Should：接收 `multipart/form-data` 文件字段（字段名与前端约定，常见 `file`），返回可访问的 `url`（本地/OSS）。

---

## 6. 字典（运行时读取 P1；系统管理 CRUD P1）

### 6.1 运行时（前端字典缓存）

#### `GET /api/dict/all` — Bearer

`data`：`Record<code, Array<{ label, value, color? }>>`，仅 **status=1** 的类型与数据。

```json
{
  "user_gender": [
    { "label": "男", "value": 1 },
    { "label": "女", "value": 0 }
  ],
  "common_status": [
    { "label": "启用", "value": 1, "color": "success" },
    { "label": "禁用", "value": 0, "color": "error" }
  ]
}
```

#### `GET /api/dict/data?code=user_gender` — Bearer

无 `code` → `data: []`。  
有 `code` → 该类型启用项，按 `sort` 升序，元素为 `{ label, value, color? }`。

#### `GET /api/dict/version` — Bearer

`data`: number（字典变更版本；前端用于失效缓存）。Nest 每次字典写操作递增。

---

### 6.2 系统管理 · 字典类型

#### `GET /api/system/dict/type/list` — Bearer · 分页

Query：`page`, `pageSize`, `name?`, `code?`, `status?`（`'0'|'1'`）

`items[]`：

```json
{
  "id": "<uuid>",
  "name": "用户性别",
  "code": "user_gender",
  "status": 1,
  "remark": "用户性别字典",
  "createTime": "2026/11/02 11:00:00"
}
```

> Mock 的 `createTime` 为 `zh-CN` + `Asia/Shanghai` 格式化字符串。Nest Should 改用 **ISO-8601 UTC**（技术方案），前端展示层格式化；若必须像素级兼容可临时双字段。

#### `POST /api/system/dict/type` — Bearer

Body：`{ name, code, remark?, status? }`（缺 name/code → 错误信封；code 重复 → 错误）  
`data`：新建完整类型对象。

#### `PUT /api/system/dict/type/:id` — Bearer

Body 可选字段：`code`, `name`, `remark`, `status`。  
改 `code` 时 mock 会级联更新该类型下 data 的 `dictCode`。

#### `DELETE /api/system/dict/type/:id` — Bearer

成功 `data: null`；并删除下属 dict data。

#### `GET /api/system/dict/type/code-exists` — Bearer

Query：`code`, `id?`  
`data`: `boolean` — `true` 表示**已存在冲突**（编辑时排除自身 `id`）。

---

### 6.3 系统管理 · 字典数据

#### `GET /api/system/dict/data/list` — Bearer · 分页

Query：`dictCode` **必填**（否则 `code: -1`），`page`, `pageSize`, `label?`, `status?`

`items[]`：

```json
{
  "id": "<uuid>",
  "dictCode": "user_gender",
  "label": "男",
  "value": 1,
  "sort": 1,
  "status": 1,
  "color": "success",
  "remark": "",
  "createTime": "…"
}
```

#### `POST /api/system/dict/data` — Bearer

Body：`dictCode`, `label`, `value` 必填；`color?`, `remark?`, `sort?`（默认 0）, `status?`（默认 1）。  
类型不存在 → 错误。

#### `PUT /api/system/dict/data/:id` — Bearer

可更新：`color`, `label`, `remark`, `sort`, `status`, `value`。

#### `DELETE /api/system/dict/data/:id` — Bearer

成功 `data: null`。

---

## 7. 系统管理 · 菜单 / 部门 / 角色 / 用户（P1）

> Mock 对 `POST|PUT|PATCH|DELETE /api/system/*`（**字典除外**）一律 403「演示环境，禁止修改」。Nest **必须实现真写**，不要复刻该中间件。

### 7.1 菜单

#### `GET /api/system/menu/list` — Bearer

`data`：管理端菜单树 `MOCK_MENU_LIST` 形状（含 `id`, `pid?`, `name`, `path`, `type`=`catalog|menu|button|embedded|link`, `status`, `authCode?`, `component?`, `meta`, `children?`）。

#### `GET /api/system/menu/name-exists` — Bearer

Query：`name`, `id?`  
`data`: `true` = 名称已被占用（排除自身）。

#### `GET /api/system/menu/path-exists` — Bearer

Query：`path`, `id?`  
`data`: `true` = 路径已被占用。

Nest Should 另增 CRUD（`POST/PUT/DELETE /api/system/menu`）供管理页；前端 playground 若仅 list + exists，按实际页面补合同修订。

---

### 7.2 部门

#### `GET /api/system/dept/list` — Bearer

**非分页**。`data`：树数组。

```json
{
  "id": "<uuid>",
  "pid": 0,
  "name": "…",
  "status": 1,
  "createTime": "…",
  "remark": "…",
  "children": [
    {
      "id": "<uuid>",
      "pid": "<parent uuid>",
      "name": "…",
      "status": 1,
      "createTime": "…",
      "remark": "…"
    }
  ]
}
```

Mock 还有 `POST /api/system/dept`、`PUT /api/system/dept/:id`、`DELETE /api/system/dept/:id` 文件，但被演示中间件拦成 403。Nest 应实现真 CRUD；body 字段对齐 list 项（创建时 `name` 必填，`pid` 默认根）。

---

### 7.3 角色

#### `GET /api/system/role/list` — Bearer · 分页

Query：`page`, `pageSize`, `name?`, `id?`, `remark?`, `startTime?`, `endTime?`, `status?`

`items[]`：

```json
{
  "id": "<uuid>",
  "name": "…",
  "status": 1,
  "createTime": "…",
  "permissions": [1, 101, 102],
  "remark": "…"
}
```

`permissions`：菜单 id 列表（与 `system/menu/list` 的 id 对应）。

---

### 7.4 用户（系统用户列表，非 `/user/info`）

#### `GET /api/system/user/list` — Bearer · 分页

Query：`page`, `pageSize`, `name?`, `id?`, `remark?`, `startTime?`, `endTime?`, `status?`, `deptId?`, `gender?`

`items[]`：

```json
{
  "id": "<uuid>",
  "name": "…",
  "status": 0,
  "gender": 1,
  "createTime": "…",
  "deptId": "<uuid>",
  "remark": "…"
}
```

| 字段 | 取值 |
|------|------|
| `status` | `0` 禁用 / `1` 启用 |
| `gender` | `0` 女 / `1` 男 / `2` 未知（与字典 `user_gender` 示例一致，以你们 seed 为准） |

Nest CRUD Should 扩展；密码只接受写入接口、永不回读。

---

## 8. 示例 / 工具接口（P2，可延后）

| 方法 | 路径 | 认证 | 说明 |
|------|------|------|------|
| GET | `/api/table/list` | Bearer | 演示表格；Query：`page`,`pageSize`,`sortBy`,`sortOrder`；分页 `items+total` |
| GET | `/api/status?status=500` | 无 | 把 HTTP 状态设为 query，返回错误信封（联调/演示） |
| GET/POST | `/api/test` | 视实现 | mock 探活，Nest 可用 `/api/v1/health` 替代 |
| GET | `/api/demo/bigint` | 视 mock | 大整数序列化演示；Nest 可选 |
| GET | `/api/timezone/getTimezone` | Bearer | 当前时区 string |
| GET | `/api/timezone/getTimezoneOptions` | 无 | `{ label, value }[]` |
| POST | `/api/timezone/setTimezone` | Bearer | body `{ timezone }`，须在白名单内 |

Nest 健康检查（技术方案）：`GET /api/v1/health/live`、`/ready` —— **Nest only**，不替代上表除非前端改掉。

---

## 9. 接口总表（速查）

| 方法 | 路径 | Auth | 信封 | 优先级 |
|------|------|------|------|--------|
| POST | `/api/auth/login` | — | 是 | P0 |
| POST | `/api/auth/refresh` | Cookie | **否（纯 token 字符串）** | P0 |
| POST | `/api/auth/logout` | Cookie | 是 | P0 |
| GET | `/api/auth/codes` | Bearer | 是 | P0 |
| GET | `/api/user/info` | Bearer | 是 | P0 |
| GET | `/api/menu/all` | Bearer | 是 | P0 |
| POST | `/api/upload` | Bearer | 是 | P1 |
| GET | `/api/dict/all` | Bearer | 是 | P1 |
| GET | `/api/dict/data` | Bearer | 是 | P1 |
| GET | `/api/dict/version` | Bearer | 是 | P1 |
| GET | `/api/system/dict/type/list` | Bearer | 分页 | P1 |
| POST | `/api/system/dict/type` | Bearer | 是 | P1 |
| PUT | `/api/system/dict/type/:id` | Bearer | 是 | P1 |
| DELETE | `/api/system/dict/type/:id` | Bearer | 是 | P1 |
| GET | `/api/system/dict/type/code-exists` | Bearer | 是 | P1 |
| GET | `/api/system/dict/data/list` | Bearer | 分页 | P1 |
| POST | `/api/system/dict/data` | Bearer | 是 | P1 |
| PUT | `/api/system/dict/data/:id` | Bearer | 是 | P1 |
| DELETE | `/api/system/dict/data/:id` | Bearer | 是 | P1 |
| GET | `/api/system/menu/list` | Bearer | 是 | P1 |
| GET | `/api/system/menu/name-exists` | Bearer | 是 | P1 |
| GET | `/api/system/menu/path-exists` | Bearer | 是 | P1 |
| GET | `/api/system/dept/list` | Bearer | 是（树） | P1 |
| POST/PUT/DELETE | `/api/system/dept`… | Bearer | 是 | P1（Nest 真写） |
| GET | `/api/system/role/list` | Bearer | 分页 | P1 |
| GET | `/api/system/user/list` | Bearer | 分页 | P1 |
| GET | `/api/table/list` | Bearer | 分页 | P2 |
| * | `/api/timezone/*` | 见上 | 是 | P2 |
| GET | `/api/status` | — | 错误 | P2 |
| GET | `/api/v1/health/*` | — | Nest | P0 运维 |

---

## 10. Nest 相对 Mock 的强制差异清单

实现时对照，避免「抄 mock 抄出漏洞」：

1. **禁止**在任何响应中返回密码哈希或明文。  
2. **Login** 最小 `data` 只需 `accessToken`；用户信息走 `/user/info`。  
3. **Refresh**：v0.1 保持「body=纯字符串」；并做 refresh 旋转 + 服务端吊销。  
4. **Cookie**：名仍为 `jwt`；CORS 凭证模式 Origin 回显。  
5. **ID**：业务主键用 UUID（技术方案 UUID v7）；mock 里用户 `id: number` 仅 demo。`/user/info` 建议同时给 `userId`（string）。  
6. **时间**：存储与 API 优先 ISO-8601 UTC；不要依赖 `zh-CN` 本地化字符串做过滤。  
7. **不要**实现「演示环境禁止修改」中间件。  
8. **Access TTL**：短于 mock 的 7d；靠 refresh 续命。  
9. 提供 `/api/v1` 正式前缀；兼容别名可标 deprecated 但 v0.x 保留。

---

## 11. 联调验收清单（最小）

- [ ] 关 Nitro mock（`VITE_NITRO_MOCK=false`），`VITE_GLOB_API_URL` 指向 Nest。  
- [ ] 三个 demo 用户可登录；错误密码 403。  
- [ ] 登录后 Cookie 出现 `jwt`；`/user/info`、`/auth/codes`、`/menu/all` 正常。  
- [ ] 人为过期 access 后，带 Cookie 调 refresh，前端静默续上（`enableRefreshToken` 开启时）。  
- [ ] logout 后 Cookie 清除，再 refresh 失败。  
- [ ] 字典 all/version 与后台改字典后 version 递增。  
- [ ] 响应无 `password` 字段。

---

## 12. 修订记录

| 版本 | 日期 | 说明 |
|------|------|------|
| 1.0.0 | 2026-11-02 | 首版：对照 `vue-vben-admin` main 的 `backend-mock` + `web-antd` 请求层落稿 |
| 1.0.1 | 2026-11-02 | Nest-only：`GET /api[/v1]/system/audit/list`（审计分页；无 mock 对照） |

---

## 附录 A · 关键源文件（核对用）

- `apps/backend-mock/utils/response.ts`
- `apps/backend-mock/utils/cookie-utils.ts`
- `apps/backend-mock/utils/jwt-utils.ts`
- `apps/backend-mock/utils/mock-data.ts`
- `apps/backend-mock/utils/dict-utils.ts`
- `apps/backend-mock/middleware/1.api.ts`
- `apps/backend-mock/api/auth/*.ts`
- `apps/backend-mock/api/user/info.ts`
- `apps/backend-mock/api/menu/all.ts`
- `apps/web-antd/src/api/request.ts`
- `apps/web-antd/src/api/core/auth.ts`
- `apps/web-antd/src/store/auth.ts`
- `packages/@core/base/typings/src/basic.d.ts`（`BasicUserInfo`）
- `packages/types/src/user.ts`（`UserInfo`）
