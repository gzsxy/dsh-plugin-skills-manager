---
name: dsh-plugin-dev
description: Use when 为 DeepSeek Harness (DSH Desktop) 开发插件、修改现有插件、排查插件安装后不生效/界面白屏/DSH 启动失败/pnpm 安装未更新文件等问题时使用。涵盖 cordis+slots 插件契约、服务端/客户端官方 API、安装发布安全流程与真实踩坑清单。
---

# DSH Plugin 开发指南

## 概览

DSH Desktop 基于 **cordis** 插件框架。一个 DSH 插件 = 声明 `dsh.bundle.patch` 的 npm 包，分**服务端**（cordis 插件，注册 HTTP 路由）与**客户端**（注入设置页/对话 UI 的 React 组件）两半。**经验来源：本项目所有坑都来自真实生产事故（含一次 DSH 无法启动），非推测。**

## 服务端契约（index.js）

```js
import { readFile } from "node:fs/promises";
export const name = "dsh-plugin-xxx";
export const inject = ["webServer"];
export async function apply(ctx) {
  const webServer = ctx.webServer;
  if (webServer === void 0) return;
  const handler = async (req, res) => { /* 原生 http 处理 */ };
  ctx.effect?.(() => webServer.register({ kind: "prefix", path: "/api/xxx", handler }), "说明");
}
```

- `webServer.register({ kind: "prefix", path, handler })`：handler 收到原生 `(req, res)`
- 路由解析时用 `pathname.indexOf(prefix)` 兼容宿主传全路径/相对路径两种情况
- 每个插件的路由挂在自己的 prefix 下；`/api` 总前缀有 dsh-client-connection 的安全栅栏（Origin/cookie 校验，外部 curl 返回 403 是预期行为）

## 客户端契约（client.js）

```js
window.__ModuleLoader__.load({ id: '包名', factory: (require) => {
  let React = null; try { React = require('react'); } catch {}
  function MyComponent(props) { /* React 组件 */ }
  function apply(ctx) {
    ctx.effect?.(() => ctx.slots.inject('settings.section',
      () => ctx.slots.register({ name: 'settings.section', id: '唯一id', order: 36, label: '显示名' }, MyComponent)
    ), '说明');
  }
  module.exports = { apply, inject: ["slots"] };   // ← inject 声明必不可少
  return module.exports;
}});
```

- 可用插槽：`settings.section`（设置页分区）、`conversation.input.right`（对话输入框右侧按钮）
- **读取/写入对话草稿必须走官方 API**（勿直接操作 DOM）：
  - 读：`props.input.draft` 或 `props.useInput(s => s)?.draft`
  - 写：`props.inputActions.setDraft(text)`
  - 直接写 textarea 在新会话中必然无效（草稿由应用状态管理，输入框可能未挂载）
- package.json 客户端声明：`"dsh": { "bundle": { "patch": "./cordis.patch.yml" }, "client": { "inject": [...], "platform": "web" } }`
- package.json `exports` 必须含 `"./client": "./client.js"` 与 `"./cordis.patch.yml"`（宿主按 exports 解析）

## 安装与发布（安全流程，血的教训）

```bash
# 1) 完全退出 DSH Desktop（⌘Q），等 10 秒 —— 运行中改 profile 会导致启动挂起！
# 2) 安装（file: 拷贝进 profile + 登记 bundles）
bash install.sh    # 脚本须内置“DSH 运行中则拒绝执行”检查
# 3) 启动 DSH Desktop
```

install.sh 必备要素：
1. **DSH 运行中则拒绝执行**（pgrep 检查）
2. 用 Desktop 托管 pnpm：`~/Library/Application Support/DSH Desktop/runtime-commands/generations/*/bin/pnpm`
3. `pnpm add "file:$PLUGIN_DIR"` + 幂等登记 `dsh.profile.bundles`（profile 在 `~/.dsh/profiles/desktop/`）
4. 备份 package.json / pnpm-lock.yaml；安装后自检（版本一致、client.js 非空、bundles 已登记）
5. **每次安装自动递增 patch 版本**（pnpm 对 file: 依赖版本不变会跳过文件刷新）
6. 允许 `DSH_PROFILE_DIR` / `DSH_PNPM_BIN` 环境变量覆盖，便于用假目录彩排

热修边界：**单个静态文件**（dashboard HTML 等）可运行中原子替换（cp 到临时名 + mv）；服务端/manifest 变更必须重启。

## 踩坑清单（症状 → 根因 → 正确做法）

| 症状 | 根因 | 正确做法 |
|---|---|---|
| DSH 启动挂起（卡在 profile-selection） | DSH 运行中执行了 pnpm 改 profile | 退出 DSH 再装；脚本强制检查 |
| 界面白屏 + 报 `cannot get property "slots" without inject` | 客户端模块未声明 `inject` 就访问 `ctx.slots` | 模块导出 `{ apply, inject: ["slots"] }`，且访问包 try/catch |
| ⚡ 按钮能弹出列表但选中后输入框无内容 | 直接写 DOM textarea；新会话草稿由应用状态管理 | `props.inputActions.setDraft(text)`；读草稿用 `props.input.draft` |
| pnpm add 成功但文件没更新 | file: 依赖版本未变，pnpm 跳过刷新 | 安装脚本自动递增 patch 版本 |
| 页面每 30 秒无限刷新 | 自愈轮询误用“扫描时间”做对比（每次请求都变） | 对比稳定指纹：技能目录名列表的 sha256 |
| 横幅/徽章常驻或计数不变 | 错误样式写死在静态 HTML；数据变更后漏重绘 | 样式类动态添加；统一 `refreshData()` 同时重绘分类与列表 |
| GitHub API 限流（60/h） | 逐目录 contents 探测消耗大 | Git Trees API 一次拉全树 + 内存缓存；简介用 raw.githubusercontent（不占配额） |
| ClawdHub 已安装检测失效 | slug 与本地目录名不一致（发布者起的通用名） | 用安装时记录的 provenance（`clawdhub:owner/slug`）精确匹配 |
| 终端脚本报 `$VAR?`: unbound variable | macOS 自带 bash 3.2：`$VAR` 后紧跟全角字符被并入变量名 | 一律 `${VAR}` 花括号；全脚本扫描 `$x` + 非 ASCII 相邻 |
| 时间显示差 8 小时 | `toISOString()` 是 UTC | 本地时间手动格式化 |
| 横幅错误提示为空 | window error 事件含无 message 的资源错误 | `if (!e || !e.message) return` 过滤 |

## 测试清单（改完必做）

- [ ] `node --check` 或 ego-browser 内 import 检查语法
- [ ] 隔离 `DSH_HOME=/tmp/xx` + 临时 http server 起路由，fetch 断言各端点
- [ ] 真实浏览器（ego-browser）打开 dashboard：渲染/搜索/安装闭环
- [ ] `bash -n` 校验安装脚本；用 `DSH_PROFILE_DIR`/`DSH_PNPM_BIN` 假目录彩排，不碰真实 profile
- [ ] 提醒用户：装新插件后首次启动需构建客户端包，慢 1-2 分钟属正常

## 环境备忘

-ego-browser 自带 Node 运行时（可 `import`、起 http server 做测试）；`page.screenshot` 的 CDP 调用在该环境易超时，验证用 DOM 断言替代
- Desktop 托管 pnpm：`~/Library/Application Support/DSH Desktop/runtime-commands/generations/*/bin/pnpm`
- 技能目录：`~/.dsh/skills`；profile：`~/.dsh/profiles/{desktop,web,headless}`
