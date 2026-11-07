# 第五轮深挖：跨站会话、登录锁恢复与配置生效

本轮先运行第四轮编译产物复现问题，再修改代码和真实依赖回归。全部验证使用本机隔离 PostgreSQL 16 / Redis 7，无线上操作；修改保留在本地工作区，未提交或推送。

## 复现与修复

| 问题 | 修复前证据与影响 | 本轮处理 |
| --- | --- | --- |
| 认证接口缺少来源校验 | 配置 SameSite=None、Secure Cookie 后，用不受信任 Origin 发送请求：logout 返回 200，原 Cookie 随后 refresh 返回 403；refresh 返回 200、旋转 Cookie，原 Cookie 失效；表单 login 返回 200 并写 Cookie。CORS 已不返回 Allow-Origin，但服务端副作用仍发生 | 给登录、刷新、退出的两个版本前缀增加 AuthOriginGuard；来源拒绝返回 403，不调用认证业务，不清写 Cookie，不旋转/撤销会话 |
| 失败计数与 TTL 分开写入 | 实际执行 Redis INCR 后注入 EXPIRE 失败，键 TTL=-1。阈值为 1 时，窗口经过后仍是 429；锁定检查先于递增，原有 TTL 修复分支无法被再次执行 | 使用单条 Redis Lua 命令处理计数和 TTL。新键 SET EX 一起创建；读取和递增先修复历史无过期键；正常读取/递增保留最初过期时间 |
| 配置误写静默削弱机制 | `CAPTCHA_REQUIRED=tru` 被解释为 false，`AUTH_FAIL_WINDOW_SEC=-1` 被接受。负数 EXPIRE 会直接删除键，破坏失败窗口 | 所有现有布尔开关严格校验；限流与锁定窗口/阈值要求正整数。补充 SMTP 端口、队列 DB index、HTTP(S) 公网 URL 和来源白名单校验 |
| 生产 Compose 没有传递部分安全配置 | 配置文件显式 environment 缺少 AUTH_FAIL_*、四个限流窗口/阈值及验证码开关；`--env-file` 插值文件中的这些设置没有进入服务容器 | 补齐这些映射；验证自定义参数和用户/IP 阈值回退 AUTH_FAIL_MAX，生产禁止验证码 bypass 的启动门禁可以实际接收到该值 |
| E2E 模式切换未实际生效 | ConfigModule 在模块导入时验证配置；部分 beforeAll 后改 process.env 的测试仍取得已验证旧值。本轮首轮回归中，来源白名单、锁定窗口和 Redis/memory 模式均暴露此问题 | 新增 app-fixture.ts，在每个测试应用创建时重新 loadEnv 并覆盖 ConfigService。五个 E2E 文件共同使用，四个独立基础夹具也分别读取自己的配置 |

来源实验验证的是服务端处理结果，不是浏览器端自动送达 Cookie。跨站 refresh/logout 的浏览器利用还要求 Cookie 可被携带，例如 SameSite=None 且浏览器允许该第三方 Cookie；默认 Lax 对跨站 POST 的限制不应被忽略。同站不同 Origin 的部署也不能单靠 SameSite 区分信任。登录设置 Cookie 的行为同样受浏览器策略影响。本轮没有声称在所有浏览器默认设置下都可利用。

损坏的 Redis 计数（NaN、负数、小数、空串、超出安全整数等）不再按零放行，相关登录返回 503。此项是依赖数据异常下的防护，不代表外部未登录用户天然拥有 Redis 写权限。

## 设计与兼容性

- 有 Origin 的认证请求只接受精确的 `CORS_ORIGINS` 或 `APP_PUBLIC_URL` 的源，不根据 Host、X-Forwarded-Host 或协议转发头建立白名单。
- `null`、来源列表、带路径或未授权源拒绝。CORS 配置允许正常化大小写、默认端口和尾部斜线；实际 Origin 头须为单个规范化的序列化源。来源配置禁止通配符、路径、query、fragment 和用户密码。
- 无 Origin 的 CLI/服务端调用继续可用；若同时报告 `Sec-Fetch-Site=cross-site` 则拒绝。代理需要保留这些浏览器头。它不是非浏览器调用的身份凭据，也不能防御受信任前端的 XSS。
- 公网 URL 仍可包含部署路径前缀，来源检查只取其 origin。反代/前端代理部署必须填写实际前端和 API 地址，不能沿用不匹配的 localhost 默认值。
- 布尔值支持 true/false/1/0，忽略大小写和两端空白；留空使用原默认值。其他值会拒绝启动。窗口/阈值为 1–2147483647 的整数，0 不表示关闭；SMTP 为 1–65535；队列 DB index 为非负 int32。
- Redis ACL 需允许 EVAL 和脚本使用的 GET、TTL、SET、INCR、EXPIRE。已有验证码/限流所需权限也须保留。Lua 出错不提供事务回滚，因此创建键使用 SET EX，修复历史 TTL 放在 INCR 之前；新增真实 ACL 拒绝 EXPIRE 的回归验证这一顺序。
- 无过期的历史锁在下一次读取时补上当前窗口，窗口从修复时算起；已有正常 TTL 不延长。坏格式键保持原值并报错，运维需核查其写入来源。Redis 执行成功但回复丢失后重试可能多计一次，本轮不提供请求幂等去重。
- refresh 成功仍为裸 access token 字符串，Cookie 名 jwt、登录数据和退出数据保持契约。来源拒绝使用既有错误信封。
- 本轮没有新增数据库迁移，运行仍需要前四轮的全部八个迁移。自定义代码若直接调用认证 service，应自行保证入口来源约束，控制器 Guard 不保护进程内直接调用。

## 验证结果

| 检查 | 结果 |
| --- | --- |
| 修复前定向实验 | 非可信来源的三种认证副作用、无 TTL 计数持续锁定、布尔误写和负数窗口均实际复现 |
| 单元回归 | 19 套件、113 项通过；清理测试类型断言后相关 env 套件 47 项再次通过 |
| 真实依赖 E2E | 5 套件、138 项全部通过，较第四轮新增 29 项 |
| 来源拒绝 | 两套前缀的 login/refresh/logout；拒绝前后数据库会话完整记录相同，不写 Set-Cookie，原 Cookie 仍可刷新；覆盖不可信、畸形、null、Host/转发头伪造和缺 Origin 的跨站 Fetch Metadata |
| 合法流程 | CORS 白名单源、API 公网源和无 Origin 客户端；登录、刷新、退出和退出后拒绝，Secure/SameSite=None Cookie、裸刷新令牌契约 |
| 计数与故障 | 64 个并发递增无丢失、正常窗口不延长、历史永久锁修复并真实到期、执行后回复丢失、非法计数 503、非法 TTL 不写入、真实 Redis ACL 拒绝 EXPIRE 时不提前递增 |
| 编译后的生产入口 | NODE_ENV=production 的 dist/main.js 在真实 PG/Redis 下 readiness、CORS、来源拒绝、可信会话全流程和 Cookie 属性通过 |
| Compose | config --format json 验证指定参数进入容器环境，用户/IP 阈值省略时继承 AUTH_FAIL_MAX；未启动生产 Compose |
| 静态检查 | Nest 构建、运行/测试/seed 类型检查、58 个修改/新增 TypeScript 文件只读 ESLint（修正唯一冗余断言后该文件复查）、git diff --check 通过 |

脚本、初始实验 JSON 和验证日志保存在仓库外的本机企业评估产物目录。测试 PostgreSQL/Redis 容器在完成后清理；用户已有容器未停用。本轮没有重建生产镜像；已有 hardening-review 镜像仍是第四轮版本，不能当作第五轮代码的发布产物。远端 CI 尚未运行。

## 对企业底座的判断与剩余工作

这批改动补齐了明确的认证请求边界、故障自动恢复和配置生效问题，但尚不足以给出生产 SLA。当前更适合作为有测试和部署约束的单租户内部管理底座。

已知尚未实现的能力仍包括租户隔离、业务数据范围、私有文件 ACL、真正的服务端人机验证，以及上传等外部副作用的 outbox。Origin 校验不替代这些能力。用户账号失败阈值仍允许针对已知用户名制造暂时锁定，这是现有防暴力破解策略的可用性取舍，需要结合业务风控决定后续策略。

还没有完成完整依赖公告处置、长时间负载/多实例网络故障演练、浏览器实际跨站策略矩阵，以及上传文件与对象存储的完整恢复演练。第四轮的小库备份恢复和本轮的短时故障回归不能推出生产容量或 RPO/RTO。
