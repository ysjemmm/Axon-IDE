# Agent Lifecycle Hooks 实现总结

> 目标：为 axon-ide-shell 打造一套达到（并超越）Cursor 水准的 Agent 生命周期 Hook 系统，
> 让 `git-ai` 等第三方工具可以零适配快速接入（例如统计 AI 写了多少代码），
> 且不绑死任何具体 agent 后端（Copilot / Claude / 自研 provider）。

本文档记录调研结论、已完成的工作、整体架构（方案 B）、文件清单，以及**剩余接线步骤**（供下一轮继续）。

---

## 1. 背景与目标

- 需求来源：希望像 Cursor 1.7 的 Hooks 那样，在 Agent 生命周期节点执行自定义脚本，
  典型场景是结合 `git-ai`（以及其它工具）统计 AI 生成的代码量。
- 核心诉求：**先做好底层架构**，第三方工具（不限于 git-ai）可快速接入。
- 关键约束：Hook 能力应成为 IDE 的核心能力，**不与任何单一 agent 厂商耦合**。

---

## 2. 调研结论：Cursor Hooks 机制

Cursor 1.7（2025，Beta）引入 Agent Lifecycle Hooks：

- 配置文件 `hooks.json`，位置：项目级 `.cursor/hooks.json`、用户级 `~/.cursor/hooks.json`、企业级 `/etc/cursor/hooks.json`，多层合并。
- 6 个生命周期事件：
  - `beforeSubmitPrompt`（仅观察）
  - `beforeShellExecution`（可 deny/allow）
  - `beforeMCPExecution`（可 deny/allow）
  - `beforeReadFile`（可 deny/过滤内容）
  - `afterFileEdit`（仅观察，提供 old_string/new_string）
  - `stop`（任务完成/中止/出错）
- 机制：每个 hook 是独立进程，stdin 收 JSON、stdout 返回 JSON；携带 `conversation_id`、`generation_id`、`workspace_roots` 等。
- 统计能力：Cursor Teams 面板有 AI Lines Added/Deleted、Acceptance Rate 等；第三方
  [`git-ai`](https://github.com/acunniffe/git-ai) 用 Git Notes 记录行级 AI 归属。

**关键发现**：axon-ide-shell 已内置一套插件级 Hook 基础设施（`pluginParsers.ts` 解析、
`copilotPluginConverters.ts` 执行），已支持 `SessionStart`/`PreToolUse`/`PostToolUse` 等，
与 Cursor 基本对齐。缺口是：`AfterFileEdit`/`BeforeFileRead`/`BeforeShellExecution` 三个事件、
一个轻量的 standalone `hooks.json` 入口、以及一个调试用的 Output Channel。

---

## 3. 整体方案演进

### 阶段一（初版，provider 相关）
先在 Copilot provider 内部把三个新事件跑通（因为工具调用的拦截点当时只在 Copilot session 里）。
这一版能用，但把 hook 派发逻辑和 Copilot 后端耦合了——自研或 Claude provider 不会自动生效。

### 阶段二（方案 B，provider 无关）——当前采用
将 hook 派发上移到**所有 provider 必经的中心层** `AgentSideEffects`，
Copilot / Claude / 自研 provider 全部通过同一套逻辑生效。provider 只负责“注册本 session 有哪些 hook 定义”这一数据职责，所有触发时机判断、执行、deny 逻辑都在 provider 无关层。

---

## 4. 方案 B 架构

```
┌─────────────────────────────────────────────────────────────┐
│ 解析层  pluginParsers.ts                                     │
│  - HOOK_TYPE_MAP 识别 AfterFileEdit/BeforeFileRead/          │
│    BeforeShellExecution（含 camelCase 别名）                 │
│  - parseHooksJson 已导出，供 standalone 入口复用             │
└───────────────────────────┬─────────────────────────────────┘
                            │ IParsedHookGroup[]
┌───────────────────────────▼─────────────────────────────────┐
│ 发现层                                                        │
│  - 插件系统（现有多种 discovery）                            │
│  - StandaloneHooksDiscovery：.axon/hooks.json（项目/全局）   │
└───────────────────────────┬─────────────────────────────────┘
                            │ 每个 session 的 hooks
┌───────────────────────────▼─────────────────────────────────┐
│ provider（copilot/claude/自研）                              │
│  - session 创建时：hookDispatch.registerSessionHooks(...)    │
│  - session 销毁时：hookDispatch.unregisterSessionHooks(...)  │
│    （唯一的 provider 参与点，仅传数据、无逻辑）              │
└───────────────────────────┬─────────────────────────────────┘
                            │
┌───────────────────────────▼─────────────────────────────────┐
│ 中心派发层（provider 无关）                                  │
│  AgentSideEffects（所有 provider 的信号唯一汇聚点）          │
│   - _handleToolReady：permissionKind==='shell'/'read'        │
│        → BeforeShellExecution / BeforeFileRead（可 deny）    │
│   - _dispatchActionForSession 的 SessionToolCallComplete 分支 │
│        + getToolFileEdits(result) → AfterFileEdit（观察）    │
│                                                               │
│  IHookDispatchService（HookDispatchService）                 │
│   - session→hooks 映射，按类型分组                           │
│   - dispatchAfterFileEdit / dispatchBeforeFileRead /         │
│     dispatchBeforeShellExecution                             │
│   - 依赖 hookExecutor 执行 shell（fail-open）                │
└──────────────────────────────────────────────────────────────┘
```

### 关键决策依据
- `AgentSideEffects` 是 Copilot 与 Claude **都必经**的唯一中心汇聚点
  （`registerProgressListener` 订阅每个 provider 的 `onDidSessionProgress`）。
- DI 注入路径复用项目现有成熟模式：`gitService`/`checkpointService` 在外层入口创建，
  作为位置参数传入 `AgentService`，内部 `services.set(...)` 给子容器供 `AgentSideEffects` 注入；
  同时 `diServices.set(...)` 供 provider 注入。**同一实例、两个 DI 作用域共享**。

---

## 5. 文件清单

### 5.1 新增文件（provider 无关核心，纯新增、已通过类型检查）

| 文件 | 职责 |
|------|------|
| `src/vs/platform/agentHost/node/hooks/hookExecutor.ts` | provider 无关的 hook 命令执行器（平台解析、spawn、stdin/stdout JSON）。导出 `executeHookCommand` / `runHookCommands` / `runHookCommandsFireAndForget` |
| `src/vs/platform/agentHost/node/hooks/hookDispatchService.ts` | `IHookDispatchService` + `HookDispatchService`：session→hooks 映射，`registerSessionHooks`/`unregisterSessionHooks`，三个 `dispatch*` 方法（gating 类 fail-open） |

### 5.2 新增文件（轻量入口 + 调试通道）

| 文件 | 职责 |
|------|------|
| `src/vs/workbench/contrib/chat/common/plugins/standaloneHooksDiscovery.ts` | 从 `.axon/hooks.json`（项目级）和 `~/.axon/hooks.json`（全局）发现 hooks，作为虚拟 plugin 暴露；带文件监听热加载 |
| `src/vs/workbench/contrib/chat/common/plugins/hookOutputChannel.ts` | `IHookOutputChannel` 接口 + `IHookLogEntry`/`HookLogSeverity` |
| `src/vs/workbench/contrib/chat/browser/plugins/hookOutputChannelImpl.ts` | 基于 `ILoggerService` 的 “Agent Hooks” Output Channel 实现 |

### 5.3 修改文件

| 文件 | 改动 |
|------|------|
| `src/vs/workbench/contrib/chat/common/promptSyntax/hookTypes.ts` | `HookType` 增加 `AfterFileEdit`/`BeforeFileRead`/`BeforeShellExecution`；`HOOKS_BY_TARGET`、`HOOK_METADATA` 同步 |
| `src/vs/platform/agentPlugins/common/pluginParsers.ts` | `HOOK_TYPE_MAP` 增加三个新类型及 camelCase 别名（含 `beforeReadFile` 兼容）；`parseHooksJson` 改为 `export` |
| `src/vs/platform/agentHost/node/copilot/copilotPluginConverters.ts` | 新增 extended hook 输入/输出类型、`IAxonExtendedHooks`、`IConvertedHooks`、`toConvertedHooks()`；`toSdkHooks` 保持兼容 |
| `src/vs/platform/agentHost/node/shared/fileEditTracker.ts` | 新增 `peekCompletedEdit(filePath)`：非破坏式读取编辑前后文本 |
| `src/vs/workbench/contrib/chat/browser/chat.shared.contribution.ts` | 注册 `StandaloneHooksDiscovery`；注册 `IHookOutputChannel` 单例 |

### 5.4 阶段一遗留（方案 B 完成后需清理/回退）

以下改动是阶段一在 Copilot provider 内的实现，方案 B 接线完成后应移除，让逻辑回归 provider 无关层：

- `src/vs/platform/agentHost/node/copilot/copilotAgentSession.ts`
  - `_dispatchAfterFileEditHook` / `_dispatchBeforeFileReadHook` / `_dispatchBeforeShellExecutionHook` 三个方法
  - `SessionWrapperFactory` 与 `ICopilotAgentSessionOptions` 里的 `extendedHooks` 字段、构造函数赋值、`initializeSession` 传递
  - `handlePermissionRequest` 里对 BeforeFileRead/BeforeShellExecution 的调用
  - `_handlePostToolUse` 里对 `_dispatchAfterFileEditHook` 的调用
- `src/vs/platform/agentHost/node/copilot/copilotAgent.ts`
  - `_buildSessionConfig` 返回的 `extendedHooks`、`_createAgentSession` 的 `extendedHooks` 参数传递
  - （改为在 session 创建/销毁时调用 `IHookDispatchService.registerSessionHooks/unregisterSessionHooks`）

> 注：`toConvertedHooks` 中的 extended hooks 部分在方案 B 下不再需要（改由 `HookDispatchService` 直接按类型筛选执行），可一并简化；`toSdkHooks` 仍保留用于 SDK 原生 hooks（PreToolUse/PostToolUse/SessionStart 等）。

---

## 6. 剩余接线步骤（下一轮执行清单）

> 目标：把已就位的 `IHookDispatchService` 接进中心层，并让 provider 注册 session hooks。
> 注意：步骤 2、4 触及**权限授权流程**，属高风险区，务必谨慎并逐步验证编译。

### Step 1 — DI 装配（两个进程入口 + AgentService）
1. `src/vs/platform/agentHost/node/agentHostServerMain.ts`
   - 在创建 provider 之前：`const hookDispatch = instantiationService.createInstance(HookDispatchService);`
   - `diServices.set(IHookDispatchService, hookDispatch);`（供 CopilotAgent/ClaudeAgent 注入）
   - 传给 `new AgentService(..., hookDispatch)`
2. `src/vs/platform/agentHost/node/agentHostMain.ts`
   - 同样创建、set、传入（这是另一个入口，勿遗漏）
3. `src/vs/platform/agentHost/node/agentService.ts`
   - 构造函数新增 `hookDispatchService: IHookDispatchService` 位置参数（照搬 `gitService`/`checkpointService`）
   - 内部 `services.set(IHookDispatchService, hookDispatchService);`（供 `AgentSideEffects` 注入）

### Step 2 — AgentSideEffects 接入（provider 无关触发点）
文件：`src/vs/platform/agentHost/node/agentSideEffects.ts`
1. 构造函数注入 `@IHookDispatchService`
2. `_handleToolReady(e, sessionKey, turnId, agent)` 开头（在 auto-approval 之前）：
   - `e.permissionKind === 'read'` 且有 `permissionPath` → `dispatchBeforeFileRead`，deny 则
     `agent.respondToPermissionRequest(e.state.toolCallId, false)` 并 dispatch 一个 denied/cancelled ready（复用现有 deny 语义），return
   - `e.permissionKind === 'shell'` → 从 `e.state.toolInput` 取命令 → `dispatchBeforeShellExecution`，同理
3. `_dispatchActionForSession` 的 `action.type === SessionToolCallComplete` 分支：
   - `for (const fe of getToolFileEdits(action.result))` → 取 `fe.before.uri`（文件路径）、`fe.diff`（added/removed）
   - `URI.parse(sessionKey)` 作为 session → `dispatchAfterFileEdit({ file_path, workspace_roots, diff })`（fire-and-forget）

### Step 3 — provider 注册 session hooks
1. `copilotAgent.ts`：`_materializeProvisional` / `_doResumeSession` 里 session 创建成功后
   `this._hookDispatch.registerSessionHooks(sessionUri, snapshot.plugins.flatMap(p => p.hooks))`
   （注入 `@IHookDispatchService`）
2. `disposeSession` / `_destroyAndDisposeSession`：`unregisterSessionHooks(sessionUri)`
3. `claudeAgent.ts`：对等处理（session 创建/销毁）

### Step 4 — 清理阶段一遗留
按 §5.4 移除 `copilotAgentSession.ts` / `copilotAgent.ts` 中的 provider 专属 extended hook 实现，
使三个事件完全由中心层驱动。

### 验证
- 每步后跑类型检查（注意：`@github/copilot-sdk` 未在本地 node_modules，`copilotAgent.ts` 会有该包缺失导致的既有级联报错，与本改动无关）。
- 端到端：写一个 `.axon/hooks.json`，用 `echo`/日志脚本验证三个事件触发时机与 deny 行为。

---

## 7. hooks.json 使用示例

放置于 `<workspace>/.axon/hooks.json` 或 `~/.axon/hooks.json`：

```json
{
  "hooks": {
    "AfterFileEdit": [
      { "command": "git-ai track --file \"${file_path}\"", "timeout": 10 }
    ],
    "BeforeShellExecution": [
      { "command": "python .axon/hooks/validate-command.py", "timeout": 5 }
    ],
    "Stop": [
      { "command": "git-ai commit --ai-authored" }
    ]
  }
}
```

- 支持 PascalCase（`AfterFileEdit`）与 camelCase（`afterFileEdit`）键名；`beforeReadFile` 作为 `BeforeFileRead` 的兼容别名。
- 每条命令支持跨平台变体（`windows`/`linux`/`osx`）、`cwd`、`env`、`timeout`（秒）。
- gating 类（`BeforeFileRead`/`BeforeShellExecution`）通过 stdout 返回
  `{ "permission": "deny", "userMessage": "..." }` 或 `{ "continue": false }` 来拦截；
  hook 执行失败一律放行（fail-open），不会卡住 agent。

---

## 8. stdin 数据契约

各事件通过 stdin 收到的 JSON（provider 无关层统一构造）：

- `AfterFileEdit`：`{ hook_event_name, session_id, file_path, workspace_roots, diff? }`
- `BeforeFileRead`：`{ hook_event_name, session_id, file_path, workspace_roots }`
- `BeforeShellExecution`：`{ hook_event_name, session_id, command, cwd?, workspace_roots }`

> 说明：中心层从 `SessionToolCallComplete` 拿到的是文件路径 + diff 计数（before/after 全文以
> `session-db:` URI 引用存储），对 git-ai 等“自行读取 git 状态”的工具已足够；如需 old/new 全文，
> 可在 `HookDispatchService` 侧扩展从 session-db 读取。
