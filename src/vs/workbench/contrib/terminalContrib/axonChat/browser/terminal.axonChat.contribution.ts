/*---------------------------------------------------------------------------------------------
 *  Axon —— 终端选区「添加到对话」浮动按钮
 *
 *  在终端中选中文本并松开鼠标后，于选区附近浮出一个按钮；点击后把选中文本与行数
 *  通过命令 `axon.addTerminalSelectionToChat` 交给 Axon 扩展，由其注入到对话输入框成为上下文芯片。
 *--------------------------------------------------------------------------------------------*/

import type { Terminal as RawXtermTerminal } from '@xterm/xterm';
import * as dom from '../../../../../base/browser/dom.js';
import { Disposable } from '../../../../../base/common/lifecycle.js';
import { localize } from '../../../../../nls.js';
import { ICommandService } from '../../../../../platform/commands/common/commands.js';
import { ITerminalContribution, IXtermTerminal } from '../../../terminal/browser/terminal.js';
import { registerTerminalContribution, type ITerminalContributionContext } from '../../../terminal/browser/terminalExtensions.js';
import './media/terminalAxonChat.css';

/** 触发注入的命令 id（由 Axon 扩展注册并处理）。 */
const ADD_TO_CHAT_COMMAND_ID = 'axon.addTerminalSelectionToChat';

/** 按钮自动消失延迟（ms） */
const AUTO_HIDE_DELAY = 3000;

export class TerminalAxonChatContribution extends Disposable implements ITerminalContribution {
	static readonly ID = 'terminal.axonChat';

	private _xterm: (IXtermTerminal & { raw: RawXtermTerminal }) | undefined;
	/** 单例按钮 DOM（终端生命周期内复用，通过 display 切换可见性） */
	private _btn: HTMLElement | undefined;
	/** 自动消失定时器 */
	private _hideTimer: ReturnType<typeof setTimeout> | undefined;
	/** 按钮是否当前可见 */
	private _visible = false;

	constructor(
		private readonly _ctx: ITerminalContributionContext,
		@ICommandService private readonly _commandService: ICommandService,
	) {
		super();
	}

	xtermOpen(xterm: IXtermTerminal & { raw: RawXtermTerminal }): void {
		this._xterm = xterm;
		const screen = this._ctx.instance.domElement ?? xterm.raw.element;
		if (!screen) {
			return;
		}

		// 创建单例按钮（初始隐藏）
		this._btn = dom.$('div.terminal-axon-add-btn');
		this._btn.textContent = localize('axon.terminal.addToChat', "添加到 Axon");
		this._btn.style.display = 'none';
		screen.style.position = 'relative'; // 确保按钮相对终端区域定位
		screen.appendChild(this._btn);

		// 防止点击按钮时清掉终端选区
		this._register(dom.addDisposableListener(this._btn, dom.EventType.MOUSE_DOWN, (e: MouseEvent) => {
			e.preventDefault();
			e.stopPropagation();
		}));
		this._register(dom.addDisposableListener(this._btn, dom.EventType.CLICK, (e: MouseEvent) => {
			e.preventDefault();
			e.stopPropagation();
			this._addToChat();
		}));

		// 鼠标松开：若存在非空选区则显示按钮
		this._register(dom.addDisposableListener(screen, dom.EventType.MOUSE_UP, (e: MouseEvent) => {
			if (e.button !== 0) {
				return;
			}
			// 使用 requestAnimationFrame 等待 xterm 更新选区状态（比 setTimeout(0) 更精确且只执行一次）
			requestAnimationFrame(() => {
				const text = this._ctx.instance.selection;
				if (text && text.trim()) {
					this._show(e.offsetX, e.offsetY);
				} else {
					this._hide();
				}
			});
		}));

		// 选区被清空时收起
		this._register(this._ctx.instance.onDidChangeSelection(() => {
			if (!this._ctx.instance.hasSelection()) {
				this._hide();
			}
		}));

		// 终端滚动时收起
		this._register(xterm.raw.onScroll(() => this._hide()));
	}

	private _show(x: number, y: number): void {
		if (!this._btn) {
			return;
		}
		// 定位到鼠标松手点偏下方（使用 absolute 相对于终端容器）
		this._btn.style.position = 'absolute';
		this._btn.style.left = `${x}px`;
		this._btn.style.top = `${y + 12}px`;
		this._btn.style.display = 'block';
		this._visible = true;

		// 重置自动消失定时器
		if (this._hideTimer !== undefined) {
			clearTimeout(this._hideTimer);
		}
		this._hideTimer = setTimeout(() => this._hide(), AUTO_HIDE_DELAY);
	}

	private _addToChat(): void {
		const text = this._ctx.instance.selection;
		this._hide();
		if (!text || !text.trim()) {
			return;
		}
		const lineCount = text.replace(/\n$/, '').split('\n').length;
		const terminalName = this._ctx.instance.title || '终端';
		Promise.resolve(this._commandService.executeCommand(ADD_TO_CHAT_COMMAND_ID, { text, lineCount, terminalName }))
			.then(undefined, () => { /* 忽略：命令不存在或扩展未就绪 */ });
	}

	private _hide(): void {
		if (!this._btn || !this._visible) {
			return;
		}
		this._btn.style.display = 'none';
		this._visible = false;
		if (this._hideTimer !== undefined) {
			clearTimeout(this._hideTimer);
			this._hideTimer = undefined;
		}
	}

	override dispose(): void {
		this._hide();
		this._btn?.remove();
		this._btn = undefined;
		super.dispose();
	}
}

registerTerminalContribution(TerminalAxonChatContribution.ID, TerminalAxonChatContribution, false);
