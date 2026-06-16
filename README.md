# Axon IDE

> AI 编程助手不该只是聊天框，它应该长在 IDE 里。

Axon IDE 基于 Code OSS 深度定制，内置 Agent 内核。Agent 直接运行在 Extension Host 中，读文件、改代码、执行命令、管理工作流都发生在编辑器内部，无需中间服务转发。

---

## 核心特性

### 🧠 进程内 Agent

Agent 内核（`@axon/core`）跑在 Extension Host 里，工具调用是函数调用而非网络请求。零延迟、零配置、零外部依赖。

### 🌐 浏览器自动化

内置 Playwright 驱动的真实浏览器：打开页面、点击交互、填写表单、读取控制台/网络请求/Storage、截图喂给多模态模型。AI 能自己测试前端。

### 🔧 完整工具集

| 类别 | 工具 |
|------|------|
| 文件操作 | read_file, create_file, str_replace, apply_patch |
| 搜索浏览 | search, list_dir |
| 命令执行 | execute_command (支持 cwd), start_process, stop_process |
| 浏览器 | open_browser, browser_click, browser_type, screenshot_page, get_browser_logs, get_browser_network, get_browser_storage, browser_eval... |
| 诊断验证 | check_diagnostics |
| 联网 | web_search, web_fetch |

### 🎯 多模型支持

通过统一路由接入多个 LLM Provider：GPT-5.5、Claude Opus 4.7、DeepSeek V4 Pro、GLM-5.1 等。Auto 模式根据任务自动选择最适合的模型。支持自定义 Provider（兼容 OpenAI API 的任意端点）。

### 📋 Relay 工作流

结构化的长任务开发流：需求 → 设计 → 任务拆分 → 逐步实现。每个阶段有确认门，AI 不会自作主张跳过评审。

### ✏️ 原生 Diff 与手动确认

Manual 模式下改动暂存待确认，打开 VS Code 原生 diff 视图逐块审查。Auto 模式直接落盘。一键切换。

### 🔌 MCP 集成

支持 Model Context Protocol 服务器。在 `.axon-ide/settings/mcp.json` 配置即可接入任意 MCP 工具。

---

## 架构

```
axon-ide-shell/          ← Code OSS fork（品牌化 Axon IDE）
  └ extensions/axon-ide/ ← 内置 Agent 扩展（junction → Axon monorepo 构建产物）

Axon/                    ← Agent 内核 monorepo
  ├ packages/core/       ← @axon/core（Agent 引擎、工具、LLM 策略）
  ├ packages/host-node/  ← Node 形态 Host（web/server/cli）
  ├ packages/host-vscode/← VSCode 形态 Host（进程内）
  ├ apps/vscode-extension/← axon-ide 扩展入口
  ├ web/                 ← React UI（侧栏 webview）
  └ server/              ← Express + WS（web 形态独立运行）
```

---

## 开发

### 环境要求

- Node.js 24（与 Code OSS 基线一致）
- Python 3 + VS Build Tools 2022（编译原生模块）
- pnpm 9+

### 构建 Agent 内核

```bash
cd Axon
pnpm install
pnpm build          # 构建所有包
pnpm --filter axon-ide build:web  # 构建前端 UI
```

### 运行 IDE（开发模式）

```bash
cd axon-ide-shell
npm ci              # 首次需要
# 确保 extensions/axon-ide 已链接
npm run watch       # 编译 + watch
# 按 F5 启动调试实例
```

### 打包发行

```bash
cd axon-ide-shell
npm run gulp vscode-win32-x64-archive    # Windows x64 免安装 zip
npm run gulp vscode-darwin-arm64         # macOS ARM
```

---

## 配置

### Provider 配置

在 UI 的 Provider Studio 中添加自定义 LLM 端点（兼容 OpenAI `/v1/chat/completions` 协议的任意服务）。

### MCP 服务器

`.axon-ide/settings/mcp.json`：

```json
{
  "mcpServers": {
    "my-server": {
      "command": "uvx",
      "args": ["my-mcp-server@latest"]
    }
  }
}
```

---

## 与其他 AI IDE 的区别

| | Axon IDE | Cursor | Windsurf | Copilot |
|---|---|---|---|---|
| 架构 | Code OSS fork + 进程内 Agent | 闭源 fork | 闭源 fork | VS Code 扩展 |
| Agent 执行 | Extension Host 内 | 云端 | 云端 | 云端 |
| 浏览器自动化 | 内置 Playwright（点击/输入/截图/控制台） | 有限 | 无 | 无 |
| 后台进程管理 | start_process / stop_process | 无 | 无 | 无 |
| 多模型 | 自由接入任意 Provider | 固定 | 固定 | 固定 |
| 工作流 | Relay（需求→设计→任务→实现） | 无 | 无 | 无 |
| 开源 | ✅ MIT | ❌ | ❌ | ❌ |

---

## License

MIT
