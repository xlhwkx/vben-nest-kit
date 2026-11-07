# 第九轮：上传解析与浏览器认证闭环

本轮落实整体复核 A01—A04 的优先修复，并补上真实 Chromium 浏览器回归。所有修改在本地工作区，未提交、推送或部署线上；没有新增迁移。

## 修改与行为

| 项目 | 修改 |
| --- | --- |
| ZIP 解压放大 | file-type 精确升级到 21.3.2，更新根锁文件。核实已安装版本保留 fileTypeFromBuffer API，并对 ZIP 文本条目/实际解压量设置 1 MiB 边界 |
| 上传回归 | 覆盖真实大小和伪造 uncompressedSize 的约 8 MiB 高压缩率样本；最终拒绝且不把超限内容交给 TextDecoder/存储。同时保留 PNG、异常 ASF 回归并验证小型 Office content-type 条目仍可识别 |
| 登录专用限流 | 在 login 处理方法上标注策略元数据，由 Reflector 读取，移除原始 URL 正则分类。大小写、版本别名、尾斜线和 query 共用同一处理方法/IP 配额 |
| 跨域登录 | web-antd loginApi 补齐 withCredentials；refresh、logout 继续携带凭据 |
| refresh 失败响应 | 缺少、无效、被消费、吊销等失败仍拒绝，但不再发送清 Cookie 的 Set-Cookie。错误登录也不清共享 Cookie。仅显式 logout 清 Cookie；原子消费、tokenVersion、会话家族注销保留 |
| 多标签页自动续期 | 新增 createRefreshCoordinator，两个前端使用 Web Locks 按 API origin 独占执行 refresh；锁等待 15 秒，HTTP 请求仍受 Axios 自身超时约束。锁失败不在锁外补发同一请求 |
| 被动重新认证 | 退出前端认证状态时传 revokeSession=false，避免一个失败标签页调用服务端 logout 吊销另一标签页的有效会话。用户主动退出默认仍执行服务端注销 |
| 排队请求重试 | 为等待续期的请求补上重试标记，重放后仍 401 时不再次启动续期 |
| playground 实际接入缺陷 | 浏览器验证发现它默认关闭自动续期，且 refresh/logout 发送 JSON null，被 Express JSON body parser 拒绝为 400。现启用默认续期并省略无用请求体，与合同及 web-antd 一致 |
| 请求包单独类型检查 | 纳入已有 packages/types/global.d.ts，加载项目的 Vue Router RouteMeta 扩展，解决单独检查时工具包中的两处类型错误；不修改工具包运行时代码 |

## 多标签页的明确边界

Web Locks 的共享域是同一前端 origin，不是 API origin；锁名按 API origin 归一化，使 `/api` 与 `/api/v1` 不会建立两套锁。每个持锁标签页实际请求时使用浏览器当前 Cookie，因此可以依次旋转而不广播 access/refresh token、不把令牌另存 localStorage。

不支持 Web Locks 的环境只使用同一 JS 上下文中的 Promise 串行队列。它不保证跨标签页协调；不同前端域名也不共享原生锁。即使这些场景下出现重复消费，服务端仍最多允许一次成功，失败响应不修改共享 Cookie，被动重新认证也不主动注销别人的有效会话。无法续期的标签页可能需要重新登录，这一降级边界没有隐藏。

本轮没有接受旧 refresh 重放、没有增加宽限期、没有缓存并重发一次性令牌。保留失效 Cookie 不会让令牌重新有效；显式 logout 仍清除 Cookie 并吊销会话家族。此约定避免无法判断请求发送先后顺序的失败响应擦掉较新的成功 Cookie。

本地浏览器测试使用回环地址、不同端口形成不同 origin，属于同站拓扑。它不代替真实跨站 Cookie、第三方 Cookie 限制、不同浏览器以及生产 HTTPS 配置验收。旧的持久化前端偏好也可能覆盖自动续期的新默认值。

## 真实浏览器回归

新增 `scripts/qingzhan/browser-auth-regression.mjs` 和根命令 `pnpm test:auth:browser`。必须显式提供前端/API URL 和测试账号密码，无默认目标或凭据；用法见 apps/server/README.md。它接入真实 Vite 模块、Axios、Pinia、Nest、PostgreSQL 和 Redis，不是复制业务逻辑的独立 HTML 示例。

web-antd 和 playground 分别在全新 Chromium 上下文完成：

1. 调用前端真实 loginApi，从不同 origin 获取 HttpOnly refresh Cookie。
2. 第一标签页在 401 后启动真实 refresh，测试扣住其成功响应；第二标签页收到 401 后，检查浏览器锁查询出现 pending，且没有发出第二个 refresh。
3. 放行第一响应后，两个续期均返回 200，原请求均成功重放。这个交错确定地验证锁等待，不依赖“两个请求恰好没有撞上”。
4. 携带旧 Cookie 的请求实际被 Nest 拒绝为 403，扣住该失败响应；另一标签页先完成新旋转，再放行失败响应，新 Cookie 保留。
5. 定向注入受保护接口 401 和 refresh 403，确认进入客户端失败分支，未发送 logout，另一标签页仍可通过真实 API 续期。
6. 用户显式 logout 发送到真实 API，Cookie 清除。

浏览器回归调用认证 API 模块，未模拟表单输入和完整管理页面操作，也尚未接入 CI。测试故障注入的范围是第 5 步和请求/响应时序控制，其余认证决策由真实后端执行。

## 验证结果

| 检查 | 结果 |
| --- | --- |
| 后端单元测试 | 21 套件、144 项通过 |
| 真实 PG16/Redis7 E2E | 7 套件、149 项通过；新增登录处理方法配额跨别名回归，补充重复 refresh 失败不发送 Set-Cookie 断言 |
| 请求客户端测试 | 6 文件、37 项通过；包含锁名、串行与失败恢复、不同 API origin、等待取消、回调失败不重复发送，以及排队重试仍 401 |
| 浏览器 | 两个前端分别通过上述 Chromium 双标签页与跨域凭据回归 |
| 类型 | 后端运行/测试/seed、两个前端应用、请求包单独类型检查通过 |
| 构建 | Nest 与两个前端生产构建通过；playground 原有 BigInt/target 构建警告仍在 |
| 生产镜像 | 当前代码重新构建镜像；空库迁移、管理员一次性初始化及重复执行拒绝、就绪/存活探针、登录与权限、Secure Cookie、指标鉴权、上传回读与额外字段拒绝、有界维护命令均通过；SIGTERM 正常退出，退出码 0 |
| 静态检查 | 本轮 8 个后端文件只读 ESLint 通过；前端/共享请求/浏览器脚本只读 Oxlint 通过；格式和 diff 检查通过 |
| 新依赖审计 | 全 workspace 由 82 条降为 81 条，file-type 公告为 0；其余公告尚未全部处理，不声称依赖零风险 |

本机测试日志和脚本位于仓库外企业评估产物目录，名称以 phase9- 开头；浏览器结果是 phase9-browser-results.json，清理证据是 phase9-cleanup.json。本轮两个临时数据库/缓存容器、镜像冒烟 API 容器及网络均已清理，未操作其他容器；保留本地镜像供复核。环境配置包含临时凭据，不应提交。

## 剩余工作

后续进展：A05—A07 已在[第十轮](./production-hardening-phase10-2026-11-07.md)推进，以下为本轮完成时的历史待办。

整体报告 A05—A11 尚未实施：菜单更新省略/清空语义、菜单祖先约束、管理编辑版本、当前仓库的 CI、OpenAPI 模型、前端主入口和根快速开始。租户/业务数据范围、私有文件、真实云存储、长期容量与恢复验收继续遵循既有范围约定。
