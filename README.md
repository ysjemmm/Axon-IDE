<div align="center">

<img src="extensions/axon-ide/media/icon.png" alt="Axon IDE" width="128" />

# Axon IDE

**AI 不应该只是一个聊天框，它应该长在 IDE 里。**

[![MIT License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE.txt)
[![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS-lightgrey)](https://github.com/ysjemmm/Axon-IDE/releases)
[![Release](https://img.shields.io/github/v/release/ysjemmm/Axon-IDE?include_prereleases)](https://github.com/ysjemmm/Axon-IDE/releases)

[下载](https://github.com/ysjemmm/Axon-IDE/releases) · [更新日志](RELEASE_NOTES.md) · [Agent 内核仓库](https://github.com/ysjemmm/Axon)

</div>

---

## 它是什么

Axon IDE 基于 Code OSS 深度定制，内置 AI Agent。Agent 直接跑在编辑器的扩展进程里：读文件、改代码、跑命令、看诊断、开浏览器都是本地调用，不经过任何中转服务器。模型用你自己的：任意 OpenAI 兼容接口或 Anthropic 协议，Key 只存在你的电脑上。

一套内核，三种工作模式：

| | |
|---|---|
| 💬 **Chat** | 提问、方案讨论、信息整理；交付 HTML / SVG 产物，把 HTML 动画渲染成 GIF / MP4 |
| 💻 **Code** | 结合编辑器上下文干活：检索、改代码、跑命令和后台服务、开浏览器验证、内联补全 |
| 📄 **Cowork** | 面向 Excel / Word / PDF / CSV：选本地文件、指定产出位置、预览结果；内置财务、会计、客服、面试官、HR 等 17 个流程模板 |

---

## 截图

<p align="center">
	<img width="1560" height="1793" alt="Axon IDE 截图" src="https://github.com/user-attachments/assets/064479b6-dcd4-4e5e-8989-7cb11c8a0621" />
</p>

---

## ✨ 能力一览

### 🧠 Agent

| | |
|---|---|
| 🧠 **进程内 Agent** | 内核跑在扩展进程里，工具调用就是函数调用，没有网络转发。 |
| 🛡️ **权限模式** | 安全（逐条审批）/ 自动 / 完全访问三档，一键切换。命令先过信任白名单（`axon.trustedCommands`）和语法预检：引号没闭合、here-string 没收尾的命令不会发到终端里卡住。 |
| 🧩 **子 Agent 并行** | `delegate_task` 把任务派给隔离的子 Agent，只把结论带回主对话；互不依赖的调研和实现可以同时开工。 |
| 🌙 **后台任务** | 大任务交给 AI 在后台独立做完；AI 启动的开发服务器等长进程在后台面板里可见，结束时自动通知并接上当前回复。 |
| 🔁 **闪电回滚** | 每轮改动自动落 git 快照，按会话隔离，回滚到任意一轮不影响其他对话。 |
| 🙋 **主动提问** | `ask_user` 选项问答、`ask_form` 表单：需要你拍板的事做成卡片，点选即回传。 |
| 📝 **任务清单与记忆** | 多步任务显示进度清单；值得跨会话保留的结论存进会话记忆。 |
| ♻️ **无感压缩** | 对话变长时自动压缩早期内容，回复进行中越线也不打断；可随时手动压缩。 |
| 🔍 **过程可见** | 思考过程、工具调用、子 Agent、命令审批全程实时展示；连续的工具调用收进折叠行，并生成一句话摘要。 |

### 📋 工作流与知识

| | |
|---|---|
| 📋 **Relay 工作流** | 结构化长任务：需求 → 设计 → 任务拆分 → 逐步实现 → 交付验证，每个阶段都有确认门。 |
| 📖 **项目 Wiki** | 一键把项目生成 Wiki 落到 `.axon/wiki/`，随 git 共享；可选模型、控制页数、随时中断；代码变了自动标记过期页，写入前扫描防止把密钥写进文档。 |
| 📦 **Skills** | 项目 / 全局 / 内置三级管理；内置头脑风暴、系统化调试、资深工程实践、代码质量、代码复用、前端设计 6 个方法论，AI 按需自动加载。 |
| ⚡ **Powers 能力包** | 「说明 + Skills + MCP」打包成一个能力包；内置文档处理（Excel / Word / PDF 读写）。 |
| 🔌 **连接器与 MCP** | 一键连接 GitHub（设备码登录）、GitLab、飞书、Notion、Slack、PostgreSQL、邮箱（Gmail / QQ / 163 / 企业邮箱）；也可接入任意 MCP 服务，远程服务支持浏览器授权。凭据只存在本机。 |
| 🌍 **Marketplace** | 把团队仓库配置成源，Skill / Power 一键安装、随时更新。 |

### ✏️ 编辑器集成

| | |
|---|---|
| ✏️ **原生 Diff** | 改动以 VS Code 原生 diff 呈现，逐个接受或拒绝；可切换自动应用，已接受的改动也能撤销。 |
| 🎯 **选区工具条** | 选中代码浮出 `解释 · 找 Bug · 测试 · 重构`，一键送进对话。 |
| 💡 **Quick Fix** | 灯泡菜单「Axon: Fix」，自动附带诊断信息和上下文代码。 |
| 🖥 **终端联动** | 终端选区一键加入对话；终端报错被主动捕获，状态栏提示，一键带进对话。 |
| 🧲 **上下文投喂** | 资源管理器右键添加、拖文件进对话框、`/` 搜索工作区文件、@ 提及、编辑器选区引用。 |
| 🎙 **语音输入** | 点输入框的麦克风说话，转成文字插到光标处；Windows 无需安装任何东西。识别服务用你自己的 Provider，推荐硅基流动的免费模型 SenseVoiceSmall，设置页有申请指引。 |
| ⚡ **内联补全** | 基于 FIM 的行内补全，Provider、模型、上下文行数、温度都可配置。 |
| 📜 **Git 追溯注解** | 行号右键开启，逐行显示最近提交的作者和时间。 |

### 🌐 浏览器与呈现

| | |
|---|---|
| 🌐 **浏览器自动化** | 内置 Playwright：打开页面、点击、填表、执行脚本、看控制台和网络请求；开发服务器还没起来时会等它就绪。截图在工具行上显示成缩略图，悬停放大、点击查看大图。 |
| 🖼 **全窗预览** | HTML / SVG / 图片 / PDF / Office / diff 在编辑器级弹层里预览，不被侧栏宽度挤扁。 |
| 🎨 **产物与媒体** | `create_artifact` 交付可交互的 HTML / SVG 产物；`render_media` 把 HTML 动画离屏渲染成 GIF / MP4。 |
| 📊 **Markdown 增强** | 代码高亮、手绘风格的 Mermaid 图（深浅主题各一套）、KaTeX 公式、HTML 预览；长回复流式输出也不卡顿。 |
| ⏱ **原稿快照** | Cowork 动过的文件保留原稿，逐行对比，一键恢复。 |

### 🎯 模型与用量

| | |
|---|---|
| 🎯 **任意模型** | OpenAI 兼容接口（Chat Completions / Responses）与 Anthropic Messages 协议；内置 DeepSeek、Kimi、智谱、通义千问、豆包、硅基流动、OpenAI、Claude、Gemini、OpenRouter、Ollama 等近 20 家厂商预设，也能接中转站。 |
| 🖼 **识图兜底** | 当前模型不支持图片时，先用指定的视觉模型把图片转成文字。 |
| 💾 **提示词缓存** | Anthropic 与支持的接口自动打缓存断点，长对话的重复部分更省钱。 |
| 💳 **用量与花费** | 按厂商模板或自定义规则查询余额 / 额度，用量总览一屏看完；每轮回复显示 token 或估算花费。 |
| 🔄 **多会话并发** | 多个会话同时运行互不打断；可编辑已发消息、从任意一轮分叉出新会话；回复进行中发的消息会被 AI 下一步看到。 |
| 🚀 **自动更新** | 直连 GitHub Releases 检查更新，确认后才下载。 |

---

## 🛠 内置工具

54 个内置工具，另有 MCP 与连接器工具按需注入：

```
📁 文件       read_file · create_file · str_replace · apply_patch · search · list_dir
⚡ 命令/进程   execute_command · start_process · get_process_output · wait_process · stop_process · list_processes
🌐 浏览器      open_browser · close_browser · screenshot_page · browser_click · browser_type · browser_press ·
              browser_select · browser_scroll · browser_reload · browser_hover · browser_wait · browser_back ·
              browser_forward · browser_set_viewport · browser_get_html · browser_eval ·
              get_browser_logs · get_browser_network · get_browser_storage
🧭 Relay      relay_create · relay_advance · relay_save_doc · relay_update_task · relay_review_task
🧩 能力       use_skill · read_skill_file · activate_power · delegate_task
💬 交互/产物   ask_user · ask_form · update_memory · update_tasks · create_artifact · edit_artifact ·
              read_artifact · report_outputs · report_checks · render_media · generate_image
🧪 诊断/联网   check_diagnostics · web_search · web_fetch
```

---

## ⌨️ 快捷键与设置

| 快捷键 | 作用 |
|---|---|
| `Ctrl/Cmd + Alt + I` | 聚焦 Axon 对话 |
| `Ctrl/Cmd + Alt + N` | 新建会话 |
| `Esc`（录音中） | 丢弃本次录音 |

模型、Provider、识图兜底、语音输入都在「模型 Provider」页里配置。常用设置组：

| 设置 | 作用 |
|---|---|
| `axon.trustedCommands` | 命令信任白名单 |
| `axon.inlineCompletion.*` | 内联补全 |
| `axon.compaction.*` | 上下文压缩 |
| `axon.creditBudget.*` | 预算预警与到顶暂停 |
| `axon.wiki.*` | Wiki 生成 |
| `axon.proactiveAwareness.*` | 终端报错、诊断变化的主动感知 |
| `axon.media.*` / `axon.image.*` | 动画渲染 / 文生图 |
| `axon.marketplace.*` | Marketplace 源 |
| `axon.trace.*` | 诊断日志（排查界面问题用命令「Axon: 查看诊断日志」） |

---

## 🏗 架构

```
Axon-IDE（本仓库）               Code OSS fork
  ├─ src/vs/                      workbench 集成：选区工具条 · 主动感知 · 预览弹层 · 自动更新
  ├─ extensions/axon-ide/         内置 Agent 扩展：侧栏界面 · 命令 · 状态栏 · webview 桥接
  └─ .github/workflows/build.yml  Windows / macOS 打包发布

Axon（独立仓库）                  Agent 内核 monorepo · https://github.com/ysjemmm/Axon
  ├─ packages/core/               Agent 引擎：会话 · 工具 · LLM 策略 · Relay · Skills · 快照 · 连接器
  ├─ packages/host-vscode/        VS Code 宿主（扩展进程内的"双手"）
  ├─ packages/host-node/          Node 宿主：终端 · 浏览器 · MCP · 存储
  ├─ apps/vscode-extension/       扩展源码（同步到本仓库 extensions/axon-ide）
  ├─ web/                         React 界面（侧栏 webview 与 Web 形态共用）
  ├─ server/                      Web 形态（Express + WebSocket）
  └─ cli/                         命令行形态
```

内核只依赖两层接口：**AgentHost**（文件、命令、进程、诊断、浏览器）和 **AgentChannel**（流式输出、工具卡片、事件）。IDE、Web、命令行三种形态共用同一个内核。

---

## 🚀 从源码构建

```bash
# 1) Agent 内核（独立仓库）
git clone https://github.com/ysjemmm/Axon.git
cd Axon && pnpm install && pnpm build

# 2) 本仓库
cd /path/to/Axon-IDE
npm ci
npm run watch          # 另开终端用 ./scripts/code.sh 启动
```

- 内核与扩展的增量构建、调试和测试见 [Axon 开发指南](https://github.com/ysjemmm/Axon/blob/master/docs/guide.md)。扩展改动需同步到本仓库的 `extensions/axon-ide`，CI 从这里打包。
- 安装包由 [`.github/workflows/build.yml`](.github/workflows/build.yml) 构建（Windows Inno Setup / macOS DMG）。

---

## 📦 下载

[Releases](https://github.com/ysjemmm/Axon-IDE/releases) 提供 Windows 和 macOS 安装包，装好后支持应用内检查更新。更新日志见 [RELEASE_NOTES.md](RELEASE_NOTES.md)。

---

## 📄 License

[MIT](LICENSE.txt)

## 生态链接

[Built with OrcaRouter](https://www.orcarouter.ai/ref/ref_f4fa997b356068930c84)
