# 青栈生产交付与验收

本文提供可执行入口和通过标准。远程隔离 CI 已在 [PR #12](https://github.com/xlhwkx/vben-nest-kit/pull/12) 执行，证据补充见第十三轮报告；合并必须核对最新提交的四项检查，写入脚本不代表验收通过。所有运行命令由维护者在允许执行的隔离环境中使用，不要把浏览器回归或 demo seed 指向生产数据库。

## 1. 固定版本与入口

记录待发布 Git commit、根锁文件、镜像 digest、迁移版本和验收环境。使用 Node 24.12+（24.x）、pnpm 11.16.0。完整管理前端是 `playground`（`pnpm dev:admin` / `pnpm build:admin`），`web-antd` 仅提供另一套 UI 的认证与路由适配示例。

两者使用 ES2022 构建目标。浏览器验收基线为当前 Chromium；其他企业指定浏览器和 Web Locks 不可用时的降级行为须另外验证。浏览器本地存储加密只用于混淆，不是凭据保护边界；任何 `VITE_*` 都不能放服务端秘密。

## 2. 构建与产物配置

```bash
pnpm install --frozen-lockfile
pnpm check:delivery:types
pnpm check:delivery:lint
pnpm test:delivery
pnpm build:admin
pnpm --filter @vben/web-antd build
pnpm check:delivery:artifacts
```

`check:delivery:artifacts` 要求两套 dist 都已构建；仅解析 `_app-config-*.js` 中的 JSON 数据，不执行产物 JavaScript。检查每个 dist 恰有一份配置、index 引用该配置、仅暴露公开前缀、不出现凭据类键名、API 为合法 HTTP(S)/同源路径且等于预期。默认预期 `/api`；跨域构建时，在构建与检查命令的环境里设置同一个 `VITE_GLOB_API_URL`。

两套 Vite 配置在启动/构建时拒绝上游 mock、Nitro mock 和验证码旁路。环境优先级为进程环境 > `.env.[mode].local` > `.env.[mode]` > `.env.local` > `.env`；运行时配置遵循同一 mode/优先级。标题和缓存命名空间位于已跟踪的开发/生产 mode 文件，干净 checkout 不依赖本地忽略的 `.env`。未知 API 主机是否确实属于本项目仍需部署方核对。

## 3. 初始化和已有库升级

以下命令均假设已通过受保护环境注入正确 `DATABASE_URL`。先备份并在演练库迁移，生产不要运行 demo seed。

```bash
pnpm --filter @qingzhan/server exec prisma migrate deploy
pnpm --filter @qingzhan/server build
```

**新空库**：以密钥管理方式提供 `BOOTSTRAP_ADMIN_USERNAME` 与 16–128 字符的强密码 `BOOTSTRAP_ADMIN_PASSWORD`，然后运行：

```bash
pnpm --filter @qingzhan/server bootstrap:admin
```

该命令仅在 users 表为空时执行，创建管理员、权限按钮、管理目录与六个页面路由，首页 `/system/user`。重复运行拒绝执行，不重置已有账号。命令不自动加载 `.env`，应由进程环境提供配置；镜像内对应 `node dist/cli/bootstrap-admin.js`。

**已有库缺管理入口**：确认目标账号当前已持有全部系统权限，提供 `ADMIN_ROUTES_USERNAME`，运行：

```bash
pnpm --filter @qingzhan/server provision:admin-routes
```

命令使用管理写锁，在一个事务中补齐导航、关联该用户专用角色、调整首页并写审计。不会给共享旧角色追加权限。遇到保留名称/路径拓扑冲突、停用或共享的导航角色、导航角色已有其他授权时拒绝并回滚。请人工复核冲突定义，不要通过重跑 seed 强行覆盖。已存在的路径/组件/权限码等关键定义不会被自动改写。

## 4. 同源站点与反向代理

发布 `playground/dist`，默认 API `/api`。以下为 Nginx location 示例，放入已有 HTTPS server 中，按实际路径调整：

```nginx
root /srv/qingzhan/admin;
index index.html;

location /api/ {
    proxy_pass http://127.0.0.1:5320;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    client_max_body_size 6m;
    client_body_timeout 60s;
    proxy_read_timeout 60s;
}
location = /index.html {
    add_header Cache-Control "no-store" always;
}
location ~ ^/_app-config-.*\.js$ {
    add_header Cache-Control "no-store" always;
}
location / {
    try_files $uri $uri/ /index.html;
}
```

示例保留 `/api` 前缀。服务端 `CORS_ORIGINS` 和 `APP_PUBLIC_URL` 填实际公开源，保留 Origin/Fetch Metadata 头；`COOKIE_SECURE=true`、SameSite 及 `TRUST_PROXY` 按 HTTPS 拓扑配置，只信任真实入口代理。公开上传走独立 `/uploads` 路由时需另配代理/文件服务，不能被 SPA fallback 接走。静态发布须成套原子切换，保留旧哈希资源供已打开的标签页加载。

默认使用 hash 路由；若改 history，必须保留刷新回退。跨域部署另验 credentials、CORS 白名单、Cookie SameSite/Secure、浏览器第三方 Cookie 策略，不可仅凭 API 工具登录成功判断浏览器可用。

## 5. 隔离浏览器回归

最方便的执行位置是 `.github/workflows/qingzhan-delivery.yml`。它为 playground/web-antd 分别新建 PG16/Redis7，生成临时密钥，迁移并显式 seed，仅启动自己创建的 Nest/Vite 进程，最后清理本次 Compose 项目。不会上传环境文件、Cookie、凭据或数据库数据。

本地手工执行时准备**独立可丢弃的测试库**，完成迁移、开发种子与 server build，安装 Playwright Chromium，并提供以下环境：

| 变量 | 测试值/要求 |
| --- | --- |
| `NODE_ENV` | `test` |
| `DATABASE_URL` / `REDIS_URL` / JWT secrets | 测试环境专用 |
| `AUTH_BROWSER_APP` | `playground` 或 `web-antd` |
| `AUTH_BROWSER_ALLOW_MUTATION` | 显式 `true`，允许测试哨兵记录和精确清理 |
| `AUTH_BROWSER_USERNAME` / `AUTH_BROWSER_PASSWORD` | seed 的 vben/123456 |
| `AUTH_BROWSER_SECONDARY_USERNAME` / `AUTH_BROWSER_SECONDARY_PASSWORD` | 不同账号 admin/123456 |
| `CORS_ORIGINS` | `http://127.0.0.1:5555,http://127.0.0.1:5666` |
| `APP_PUBLIC_URL` | `http://127.0.0.1:5320` |
| `COOKIE_SECURE` / `COOKIE_SAME_SITE` | `false` / `lax`，仅隔离 HTTP 测试 |
| `CAPTCHA_REQUIRED` / `CAPTCHA_E2E_BYPASS` | 均为 `false` |

```bash
pnpm exec playwright install --with-deps chromium
pnpm test:delivery:browser
```

runner 固定使用 loopback API 5320、前端 5555/5666；端口被占用就拒绝启动，不复用已有服务。它设置真实跨 origin API 地址，先运行认证 Cookie 回归，再运行交付回归。测试限流应足够覆盖重复登录，具体参数参照 workflow。发生回归时哨兵清理仅匹配本次 UUID 前缀；基础设施销毁仍是最终隔离保障。

自动覆盖：跨域 HttpOnly Cookie、多标签页串行续期、迟到失败不清新 Cookie、被动重认证不吊销其他标签页、旧账号写请求零发送、续期期间切号时排队写零重放、无共享标记时 expectedUserId 拒绝错号、退出失败保留状态与重试、服务端恶意 iframe URL 拒绝、缓存恶意 iframe 不渲染、合法 iframe sandbox 隔离。playground 另外检查六个管理页面真实 GET 请求；web-antd 不宣称有管理页面。

这些脚本导入 Vite 源模块，不能替代正式 dist 的真实浏览器验收。上线前需在 HTTPS 预发站对生产压缩包实际完成登录、刷新、退出、六个管理入口及权限拒绝检查。

## 6. 发布门槛与证据

| 项目 | 通过标准 | 当前证据状态 |
| --- | --- | --- |
| 静态质量 | 两套前端、request/utils/Vite 配置、后端运行/测试/seed 类型与相关 lint 无错误 | 本轮执行记录见第十三轮报告 |
| 自动回归 | 同一个 commit 的后端与交付 workflow 全绿 | 见 PR #12 最新提交检查；不可引用旧轮测试数替代 |
| 管理员初始化 | 空库首建可登录管理页面；重复 bootstrap 拒绝；已有库仅指定管理员获路由 | 远程后端 CI 已通过；页面联调以最新浏览器检查及预发验收为准 |
| 正式站点 | HTTPS、Cookie/CORS、生产 dist、刷新/退出与权限拒绝实际通过 | 待目标环境验收 |
| 容量 | 约定并发、数据量、P95/P99、失败率、内存和连接数预算；压力下恢复 | 待业务规模压测 |
| 备份恢复 | DB 与文件恢复演练达到业务约定 RPO/RTO | 待目标环境验收 |
| 能力边界 | 租户/行级隔离、私有附件、SSO/MFA、真实人机验证等按业务明确 | 见根 README，不以骨架当完成功能 |

建议分支保护要求 `Server build + e2e`、`Delivery types, regressions and builds` 和两个 `Browser integration (...)` 检查。两个工作流都对 main 的 PR/推送触发且没有 paths 过滤，避免必需检查因跳过而永久 pending。未自动更改 GitHub 分支保护或派发 workflow。
