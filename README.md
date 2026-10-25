<div align="center">

<img src="extensions/axon-ide/media/icon.png" alt="Axon IDE" width="128" />

# Axon IDE

**AI 不应该只是一个聊天框，它应该长在 IDE 里。**

[![MIT License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE.txt)
[![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-lightgrey)](https://github.com/ysjemmm/Axon-IDE/releases)
[![Release](https://img.shields.io/github/v/release/ysjemmm/Axon-IDE?include_prereleases)](https://github.com/ysjemmm/Axon-IDE/releases)

</div>

---

## 它是什么

Axon IDE 基于 Code OSS 深度定制，内置 AI Agent 引擎。Agent 直接跑在 Extension Host 里——读文件、改代码、执行命令、工作区管理都在编辑器内部完成，零转发、零延迟。

一套内核，三种工作模式：

| | |
|---|---|
| 💬 **Chat** | 提问、方案讨论、信息整理；也能交付 HTML/SVG 产物、渲染 GIF/MP4 动画 |
| 💻 **Code** | 结合编辑器上下文干活：检索、改代码、跑命令、浏览器验证、内联补全 |
| 📄 **Cowork** | 面向 Excel / Word / PDF / CSV：选本地文件、指定产出位置、预览结果，会话与开发场景分开管理 |

Agent 能看到你的终端报错、诊断变化，主动感知问题。浏览器自动化能力让 AI 像人一样操作网页：打开页面、填写表单、截图喂给多模态模型。

---

## 截图

<p align="center">
	<img width="1560" height="1793" alt="image" src="https://github.com/user-attachments/assets/064479b6-dcd4-4e5e-8989-7cb11c8a0621" />
</p>

---

## ✨ 能力一览

### 🧠 Agent 内核

| | |
|---|---|
| 🧠 **进程内 Agent** | Agent 内核跑在 Extension Host 里，工具调用是函数调用。零延迟，零网络转发。 |
| 🧩 **子代理 · 并行** | `delegate_task` 把任务派给隔离的子 Agent，只把结论带回主上下文；一次可同时派多个子代理，互不依赖的调研 / 实现并行开工（Beta）。 |
| 🔁 **闪电回滚** | 每轮改动自动落 git 快照，按会话隔离——回滚到任意一轮，不影响其他对话。 |
| 🛡️ **命令信任门** | shell 命令先过信任规则：白名单（`axon.trustedCommands`）直接放行，其余逐条确认；另有循环检测、重复调用拦截等护栏。 |
| 🧠 **会话记忆** | `update_memory` 把值得跨会话带走的结论浓缩成 md 存进会话，支持导入现有 `.md`。 |
| 🙋 **主动提问** | `ask_user` 选项问答、`ask_form` 声明式表单——需要你拍板的事做成卡片，点选即回传。 |
| ♻️ **上下文压缩** | 对话过长自动摘要旧内容（`axon.compaction.*`），也可随时手动压缩。 |
| 🔍 **过程可见** | 思维链、工具调用卡片、子代理事件、命令审批，全程实时展示。 |

### 📋 工作流与知识

| | |
|---|---|
| 📋 **Relay 工作流** | 结构化长任务流：需求 → 设计 → 任务拆分 → 逐步实现 → 交付验证。每阶段确认门，不跳过评审。 |
| 📖 **项目 Wiki** | 一键把项目生成 Wiki 落到 `.axon/wiki/`（随 git 提交、团队共享）；模型可选、页数可控、生成可中断。 |
| 📦 **Skills 技能** | 项目 / 全局 / 内置三级分组，创建、导入、启停、批量管理；内置系统化调试、TDD、提交评审自检、根因追溯、完成前验证 5 个方法论，`use_skill` 按需自动加载。 |
| ⚡ **Powers 能力包** | `POWER.md` 打包「说明书 + Skills + Steering + MCP」；内置**文档处理**（Excel / Word / PDF 读写），`activate_power` 一键激活。 |
| 🌍 **Marketplace** | 把团队仓库配置成源，Skill / Power 一键安装、随时更新。 |
| 🔌 **MCP** | 通过 `mcp.json` 接入任意 MCP 工具，管理界面支持启停、批量删除；Power 可自带 MCP 服务器。 |

### ✏️ 编辑器深度集成

| | |
|---|---|
| ✏️ **原生 Diff** | 改动暂存为 VS Code 原生 diff 视图，逐行审查后接受或拒绝。一键切换自动/手动模式，随时撤销已接受的编辑。 |
| 🎯 **选区工具条** | 选中代码浮出 `[✦ Axon] 解释 · 找Bug · 测试 · 重构`，一键送进对话。 |
| 💡 **Quick Fix** | 灯泡菜单「Axon: Fix」，自动附带诊断信息与上下文代码。 |
| 🖥 **终端联动** | 终端选区浮出「添加到 Axon」按钮；报错被主动感知捕获 → 状态栏 badge → 一键带进对话。 |
| 🧲 **上下文投喂** | 资源管理器右键「添加到对话」、文件直接拖进对话框、输入 `/` 搜索工作区文件、@ 提及附件、编辑器选区一键引用。 |
| ⚡ **内联补全** | 基于 FIM 的行内补全，provider / 模型 / 上下文行数 / 温度全部可配。 |
| 📜 **Git 追溯注解** | 行号右键「使用 Git 追溯注解」，逐行显示最近提交作者与时间（未跟踪文件按 mtime 兜底）。 |

### 🎯 模型与用量

| | |
|---|---|
| 🎯 **多模型** | 自由接入任意 OpenAI 兼容端点，另支持 Anthropic Messages 协议。GPT、Claude、DeepSeek、GLM…… Auto 模式自动选模型，可配置视觉回退模型。 |
| 🛠 **Provider 管理** | 用户 / 工作区两级配置界面；API Key 走 SecretStorage；模型探测、thinking 能力识别、配额查询（自定义接口 + token 自动刷新）。 |
| 💳 **Credits 用量** | 状态栏实时显示已用 / 总额度（5 分钟刷新 + 相对时间），点击打开账户用量弹窗。 |
| 💰 **预算门** | `axon.creditBudget.*`：本地 credits 超阈值预警、到顶自动暂停，长任务不怕跑飞。 |
| 🔄 **多会话并发** | 按标签页切换会话，后台任务持续运行不中断；支持编辑已发消息、从任意一轮分叉出新会话。 |

### 🖥 Cowork 与呈现

| | |
|---|---|
| 📄 **Cowork 文档流** | 原生文件选择器选取本地文件（Excel / PDF 拿得到绝对路径）→ 指定产出目录 → 任务进展 → 产物预览卡片。 |
| ⏱ **原稿快照** | AI 动过的文件保留原稿快照，改动浮层逐行对比，一键「恢复原稿」。 |
| 🖼 **全窗预览** | workbench 级预览弹层：HTML / SVG / 图片 / PDF / 文本 / Office / diff，不再被侧栏宽度挤扁。 |
| 🎨 **产物与媒体** | `create_artifact` 交付 HTML / SVG 等产物卡片；开启后 `render_media` 把 HTML 动画离屏渲染成 GIF / MP4（可选本机语音旁白）。 |
| 📊 **Markdown 增强** | SVG、Mermaid 图表、KaTeX 公式、HTML 预览，流式输出不闪烁。 |
| 🤖 **智能终端** | 终端按工作区复用，跨会话不串台。 |
| 🚀 **自动更新** | 直连 GitHub Releases 检查更新（可设启动后自动检查 + 黄点提示），确认后才下载；Release Notes 在编辑器内打开。 |

---

## 🛠 工具集

49 个内置工具 + MCP 动态工具：

```
📁 文件       read_file · create_file · str_replace · apply_patch · search · list_dir
⚡ 命令/进程   execute_command · start_process · get_process_output · stop_process · list_processes
🌐 浏览器      open_browser · close_browser · screenshot_page · browser_click · browser_type ·
              browser_press · browser_select · browser_scroll · browser_reload · browser_hover ·
              browser_wait · browser_back · browser_forward · browser_set_viewport ·
              browser_get_html · browser_eval · get_browser_logs · get_browser_network ·
              get_browser_storage
🧭 Relay     relay_create · relay_advance · relay_save_doc · relay_update_task · relay_review_task
🧩 能力       use_skill · activate_power · delegate_task
💬 交互       ask_user · ask_form · update_memory · create_artifact · report_outputs · render_media
🧪 诊断       check_diagnostics
🌍 联网       web_search · web_fetch
🔌 MCP        mcp__*（随接入的服务器动态生成）
```

> Wiki 生成流程另有专用工具 `wiki_plan_pages` / `wiki_save_page`，仅在生成期间注入。

---

## ⌨️ 快捷键与设置

| 快捷键 | 作用 |
|---|---|
| `Ctrl/Cmd + Alt + I` | 聚焦 Axon 对话 |
| `Ctrl/Cmd + Alt + N` | 新建会话 |

常用设置组：`axon.inlineCompletion.*`（内联补全）· `axon.compaction.*`（上下文压缩）· `axon.creditBudget.*`（Credits 预算门）· `axon.trace.*`（追踪日志四档，界面卡死排查用命令「Axon: 查看诊断日志」）· `axon.proactiveAwareness.*`（主动感知）· `axon.wiki.*`（Wiki 生成）· `axon.trustedCommands`（命令信任白名单）

---

## 🗺 对比

| | Axon IDE | Cursor | Windsurf | Copilot |
|---|:---:|:---:|:---:|:---:|
| 代码 | Code OSS fork | 闭源 fork | 闭源 fork | VS Code 扩展 |
| Agent 位置 | 本地进程内 | 云端 | 云端 | 云端 |
| 浏览器自动化 | ✅ 内置 Playwright | ❌ | ❌ | ❌ |
| 后台进程管理 | ✅ start / stop | ❌ | ❌ | ❌ |
| 自定义模型 | ✅ 任意 Provider | 固定 | 固定 | 固定 |
| 工作流 | ✅ Relay | ❌ | ❌ | ❌ |
| 开源 | ✅ MIT | ❌ | ❌ | ❌ |

---

## 🏗 架构

```
Axon-IDE（本仓库）                ← Code OSS fork（品牌化）
  ├─ src/vs/                       workbench 集成层：选区工具条 · 主动感知 · 预览弹层 · 自动更新 …
  ├─ extensions/axon-ide/          内置 Agent 扩展：TreeView · 状态栏 · webview 桥接 · 50 个命令
  └─ .github/workflows/            Windows / macOS 打包发布

Axon（独立仓库）                   ← Agent 内核 monorepo · https://github.com/ysjemmm/Axon
  ├─ packages/core/                Agent 引擎：会话 · 工具 · LLM 策略 · Relay · Skills · 快照
  ├─ packages/host-vscode/         VS Code 宿主实现（进程内的"双手"）
  ├─ packages/host-node/           Node 宿主实现（server / cli 共用）
  ├─ apps/vscode-extension/        扩展源码（与本仓库 extensions/axon-ide 保持同步）
  ├─ web/                          React 前端（侧栏 webview / Web 形态复用）
  ├─ server/                       Web 形态（Express + WebSocket）
  └─ cli/                          命令行形态

同一内核，两层抽象：
  AgentHost    — "双手"：文件 · 命令 · 进程 · 诊断 · 浏览器
  AgentChannel — "嘴"：流式输出 · 工具卡片 · 事件（WebSocket / postMessage）
```

---

## 🚀 构建

```bash
# 1) Agent 内核 monorepo（独立仓库，首次先克隆）
git clone https://github.com/ysjemmm/Axon.git
cd Axon && pnpm install && pnpm build   # turbo 按依赖序构建 core → host → server → web → extension

# 2) 本仓库（Code OSS fork）
cd /path/to/Axon-IDE
npm ci
npm run watch                           # ./scripts/code.sh 启动运行
```

- 内核与扩展的增量构建（`copy-web` / `esbuild` / `tsc --watch`）、测试，见 [Axon 开发指南](https://github.com/ysjemmm/Axon/blob/main/docs/guide.md)；扩展源码改动需同步到本仓库 `extensions/axon-ide`（CI 从此处打包）。
- 平台安装包由 [`.github/workflows/build.yml`](.github/workflows/build.yml) 完成（Windows Inno Setup / macOS DMG）。

---

## 📦 下载

[Releases](https://github.com/ysjemmm/Axon-IDE/releases) 页面提供 Windows 和 macOS 安装包，装好后支持应用内检查更新。

更新日志见 [RELEASE_NOTES.md](RELEASE_NOTES.md)。

---

## 📄 License

MIT

## 生态链接

[Built with OrcaRouter](https://www.orcarouter.ai/ref/ref_f4fa997b356068930c84)
