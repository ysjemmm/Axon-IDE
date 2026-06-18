<div align="center">

<img src="extensions/axon-ide/media/icon.png" alt="Axon IDE" width="128" />

# Axon IDE

**AI 不应该只是一个聊天框，它应该长在 IDE 里。**

[![MIT License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE.txt)
[![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-lightgrey)](https://github.com/ysjemmm/Axon-IDE/releases)

</div>

---

## 它是什么

Axon IDE 基于 Code OSS 深度定制，内置 AI Agent 引擎。Agent 直接跑在 Extension Host 里——读文件、改代码、执行命令、工作流管理都在编辑器内部完成，零转发、零延迟。

Agent 能看到你的终端报错、诊断变化，主动感知问题。浏览器自动化能力让 AI 像人一样操作网页：打开页面、填写表单、截图喂给多模态模型。

---

## 截图

<!--
  替换为实际截图。建议：
  - 一张全貌（侧栏对话 + 编辑器 + Relay 面板）
  - 一张浏览器自动化的特写
  - 一张 diff 审查界面
-->

<p align="center">
  <em>截图待补充</em>
</p>

---

## ✨ 能力一览

| | |
|---|---|
| 🧠 **进程内 Agent** | Agent 内核跑在 Extension Host 里，工具调用是函数调用。零延迟，零网络转发。 |
| 🌐 **浏览器自动化** | 内置 Playwright 真实浏览器。AI 能打开页面、点击按钮、填写表单、截图喂给视觉模型。 |
| 📋 **Relay 工作流** | 结构化长任务流：需求 → 设计 → 任务拆分 → 逐步实现。每阶段确认门，不跳过评审。 |
| ✏️ **原生 Diff** | 改动暂存为 VS Code 原生 diff 视图，逐行审查后接受或拒绝。一键切换自动/手动模式。 |
| 🎯 **多模型** | 自由接入任意 OpenAI 兼容端点。GPT、Claude、DeepSeek、GLM……Auto 模式自动选模型。 |
| 🔌 **MCP** | 通过 `mcp.json` 接入任意 MCP 工具，Agent 自动调用。 |
| ⚡ **主动感知** | 终端报错、诊断变化 → 侧栏 badge 通知，AI 能主动问"需要帮忙吗"。 |
| 🔄 **多会话并发** | 按标签页切换会话，后台任务持续运行不中断。 |

---

## 🛠 工具集

```
📁 文件操作    read_file · create_file · str_replace · apply_patch
🔍 搜索浏览    search · list_dir
⚡ 命令执行    execute_command · start_process · stop_process · list_processes
🌐 浏览器      open_browser · click · type · screenshot · logs · network · storage · eval
🧪 诊断验证    check_diagnostics
🌍 联网        web_search · web_fetch
```

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
axon-ide-shell/          ← Code OSS fork（品牌化）
  └ extensions/axon-ide/ ← 内置 Agent 扩展

Axon/                    ← Agent 内核 monorepo
  ├ packages/core/         Agent 引擎 · 工具 · LLM 策略
  ├ packages/host-vscode/  VS Code Extension Host 适配
  ├ packages/host-node/    Node 形态适配（server/cli）
  ├ web/                   React 前端（侧栏 webview）
  └ server/                Web 形态独立运行
```

---

## 🚀 构建

```bash
# Agent 内核
cd Axon && pnpm install && pnpm build

# 编译扩展 + 前端
cd extensions/axon-ide && node esbuild.mjs
cd ../../web && npx vite build

# 运行（F5 启动调试）
cd ../.. && npm run watch
```

平台构建详见 [`.github/workflows/build.yml`](.github/workflows/build.yml)。

---

## 📦 下载

[Releases](https://github.com/ysjemmm/Axon-IDE/releases) 页面提供 Windows 和 macOS 安装包。

---

## 📄 License

MIT
