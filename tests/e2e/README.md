# tests/e2e/ —— 可复用的端到端 / 取证脚本

与 `tests/verify-*.js` 的区别：

| | `tests/verify-*.js` | `tests/e2e/*.js`（本目录） |
|---|---|---|
| 性质 | **断言套件**，有通过/失败判定 | **取证/操作工具**，看输出自己判断 |
| 运行 | 每次改代码都跑，必须全绿 | 需要时才跑，很多要连线上 |
| 副作用 | 无（纯读） | 有：可能发邮件、写库、改数据 |

## 分类索引

### 真机/桌面取证（排查线上问题用）
| 脚本 | 用途 |
|---|---|
| `cdp-check-panel.js` | CDP 连 msedge 打开线上页，读自检面板每行 |
| `cdp-inspect.js` / `cdp-diag.js` | CDP 打开页面做 DOM/环境取证 |
| `cdp-click-real.js` / `cdp-click-trace.js` | CDP 模拟点击并追踪 |
| `cdp-inpage-fetch.js` | 在页面内发 fetch，看真实请求 URL 与响应 |
| `local-load-check.js` | jsdom 加载本地页面，抓启动期 JS 错误 |

### 接口链路验证
| 脚本 | 用途 |
|---|---|
| `probe-asr-size.js` | 按体积阶梯探 `/api/asr`（含 Origin，模拟浏览器） |
| `ab-chat-asr.js` | chat vs asr 跨域/同域对照实验 |
| `slow-post.js` / `repro-crossorigin.js` | 慢网 / 跨域复现 |
| `t-verify-live.js` | 线上接口全量探活（poster/admin/login） |

### ⚠️ 会改数据的（跑前先看清）
| 脚本 | 风险 |
|---|---|
| `e2e-two-img-fetch.js` → `e2e-two-img-send.js` | **真发邮件**（走 `/api/mail` 无 id 内联模式，不写库） |
| `e2e-mail.js` / `e2e-mail-full.js` | 同上 |
| `t-e2e-update.js` | 改 #9 记录（会备份、会还原） |
| `t-e2e-autosend.js` / `t-e2e-flow-attach.js` | 全流程含发信 |
| `t-report-edit-e2e.js` | 编辑报告正文 |
| `reset9.js` | 读 #9 的修订状态（只读，但名字像写操作） |
| `t-cleanup.js`（已随 tmp 清理） | 删除记录 |

### 打标 / 报告
| 脚本 | 用途 |
|---|---|
| `t-tag-live.js` | 对**真实报告**跑打标并统计（读 `../tmp/full-reports.json`） |
| `dbg-tag10.js` | 单条打标调试（读 `../tmp/full-reports.json`） |
| `t-report-audit.js` | 逐条判定有无「海报摘要」节 |
| `t-p01-report.js` | 跑一次完整报告生成（只调 chat，不写库） |

### 页面预览生成（产 HTML 供人眼看）
`mk-full-preview.js` / `mk-tag-preview.js` / `mk-report-edit-preview.js` / `mk-p01-preview.js`
`gen-cov-preview.js` / `gen-form-preview.js` / `gen-owner-preview.js`
`render-preview.js` / `poster-test.js` / `gate-preview.js` / `t-render-edit-panel.js`

### 其它
`make-probe.js`（生成带溢出探针的页面）、`diff9.js`、`iv.js`、`_adm_check.js`、`fix-secret.py`

## 约定

1. **产物一律写 `tests/e2e/out/`**（已 gitignore），不要写到本目录。
2. **真实数据输入放 `tests/tmp/`**（已 gitignore）：跑之前现场从后台拉。
   例：`node tools/fetch_reports.py json > tests/tmp/full-reports.json`
3. **脱敏样本放 `tests/fixtures/`**（入库）。
4. 路径基准：本目录与 `tests/tmp/` 同为两层深，所以 `__dirname/../..` = 项目根。
5. **带 `t-` 前缀的**、以及 `e2e-*` 的，多数要连线上真实环境——跑前确认影响面。

## 常用命令

```bash
export NODE_PATH=C:/Users/Furina/.workbuddy/binaries/node/workspace/node_modules
N=C:/Users/Furina/.workbuddy/binaries/node/versions/22.22.2-3/node.exe

"$N" tests/e2e/local-load-check.js       # 本地页面启动期健康
"$N" tests/e2e/t-verify-live.js          # 线上接口探活
"$N" tests/e2e/t-report-audit.js         # 报告结构审计
```
