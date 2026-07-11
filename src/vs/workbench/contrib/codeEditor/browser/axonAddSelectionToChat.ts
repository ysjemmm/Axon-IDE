/*---------------------------------------------------------------------------------------------
 *  Axon —— 编辑器选区浮动操作栏
 *
 *  选中 ≥10 字符的文本并静止 600ms 后，在选区上方浮出一行紧凑的水平操作栏：
 *    [✦ Axon] [解释] [找Bug] [测试] [重构]
 *  点击后把选中代码及其位置范围交给 Axon 扩展处理。
 *
 *  交互优化（不打扰用户）：
 *  - 选中后需静止 600ms 才弹出（快速选中+复制不触发）
 *  - 选区 < 10 字符不触发（双击选词等轻操作不干扰）
 *  - 鼠标离开编辑器 / 按 Esc / 滚动 / 切文件 → 立即消失
 *  - 3s 无操作自动消失
 *--------------------------------------------------------------------------------------------*/

import * as dom from '../../../../base/browser/dom.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { localize } from '../../../../nls.js';
import { ContentWidgetPositionPreference, ICodeEditor, IContentWidget, IContentWidgetPosition } from '../../../../editor/browser/editorBrowser.js';
import { EditorContributionInstantiation, registerEditorContribution } from '../../../../editor/browser/editorExtensions.js';
import { IEditorContribution } from '../../../../editor/common/editorCommon.js';
import { ICommandService } from '../../../../platform/commands/common/commands.js';

const $ = dom.$;

/** 触发"添加到 Axon"的命令 id */
const ADD_TO_CHAT_COMMAND_ID = 'axon.addEditorSelectionToChat';

/** 一键操作：Action → 命令 id */
const QUICK_ACTIONS: { action: string; label: string; command: string }[] = [
	{ action: 'explain', label: localize('axon.editor.explain', '解释'), command: 'axon.quickExplain' },
	{ action: 'findBug', label: localize('axon.editor.findBug', '找Bug'), command: 'axon.quickFindBug' },
	{ action: 'test', label: localize('axon.editor.test', '测试'), command: 'axon.quickTest' },
	{ action: 'refactor', label: localize('axon.editor.refactor', '重构'), command: 'axon.quickRefactor' },
];

/** 弹出延迟（ms）：选中后静止这么久才弹，避免快速选中+复制时弹出 */
const SHOW_DELAY = 600;
/** 最小选区字符数：太短的选区（双击选词等）不触发 */
const MIN_SELECTION_LENGTH = 10;
/** 按钮自动消失延迟（ms） */
const AUTO_HIDE_DELAY = 3000;

class AxonSelectionActionBar implements IContentWidget {
	static readonly ID = 'axon.editor.selectionActionBar';

	readonly allowEditorOverflow = true;
	readonly suppressMouseDown = true;

	private readonly _domNode: HTMLElement;
	private _position: IContentWidgetPosition | null = null;

	constructor(
		onAddToChat: () => void,
		onQuickAction: (action: string) => void,
	) {
		// ── 容器：水平浮动工具条（单行，紧凑精致） ──
		// 用 setProperty + important 强制覆盖 monaco editor 对 content widget 内元素的全局 CSS。
		this._domNode = $('div.axon-selection-action-bar');
		const setImp = (prop: string, val: string) => this._domNode.style.setProperty(prop, val, 'important');
		setImp('display', 'flex');
		setImp('flex-direction', 'row');
		setImp('flex-wrap', 'nowrap');
		setImp('align-items', 'center');
		setImp('height', '26px');
		setImp('width', 'max-content');
		setImp('max-width', 'none');
		setImp('gap', '0');
		setImp('border-radius', '6px');
		setImp('position', 'relative');
		setImp('box-shadow', '0 2px 12px rgba(0, 0, 0, 0.28), 0 0 0 1px rgba(128,128,128,0.12)');
		setImp('background-color', 'var(--vscode-editorWidget-background, #1e1e1e)');
		setImp('user-select', 'none');
		setImp('white-space', 'nowrap');
		setImp('z-index', '100');
		setImp('font-family', 'var(--vscode-font-family, system-ui)');
		setImp('font-size', '11px');
		setImp('line-height', '26px');
		setImp('overflow', 'visible');
		setImp('opacity', '0');
		setImp('transform', 'translateY(3px) scale(0.96)');
		setImp('transition', 'opacity 0.12s ease-out, transform 0.12s ease-out');
		// 入场动画
		requestAnimationFrame(() => {
			setImp('opacity', '1');
			setImp('transform', 'translateY(0) scale(1)');
		});

		// ── "✦ Axon" 主按钮 ──
		const addBtn = this._makeButton('✦ Axon', true);
		this._bindAction(addBtn, onAddToChat);
		this._domNode.appendChild(addBtn);

		// ── 竖分隔线 ──
		this._domNode.appendChild(this._makeSep());

		// ── 快捷操作按钮（水平排列，无额外分隔线） ──
		for (const qa of QUICK_ACTIONS) {
			const btn = this._makeButton(qa.label, false);
			this._bindAction(btn, () => onQuickAction(qa.action));
			this._domNode.appendChild(btn);
		}
	}

	private _makeButton(text: string, primary: boolean): HTMLElement {
		const btn = $('div.axon-sel-btn');
		btn.textContent = text;
		const s = btn.style;
		const setImp = (prop: string, val: string) => s.setProperty(prop, val, 'important');
		setImp('display', 'inline-flex');
		setImp('align-items', 'center');
		setImp('flex', '0 0 auto');
		setImp('padding', '0 10px');
		setImp('height', '26px');
		setImp('line-height', '26px');
		setImp('white-space', 'nowrap');
		s.cursor = 'pointer';
		s.transition = 'background-color 0.1s, color 0.1s';
		if (primary) {
			s.color = 'var(--vscode-button-foreground, #fff)';
			s.backgroundColor = 'var(--vscode-button-background, #0078d4)';
			s.fontWeight = '500';
			s.letterSpacing = '0.2px';
			btn.addEventListener('mouseenter', () => { s.filter = 'brightness(1.12)'; });
			btn.addEventListener('mouseleave', () => { s.filter = 'none'; });
		} else {
			s.color = 'var(--vscode-descriptionForeground, #999)';
			s.backgroundColor = 'transparent';
			s.fontWeight = '400';
			btn.addEventListener('mouseenter', () => {
				s.backgroundColor = 'var(--vscode-list-hoverBackground, rgba(255,255,255,0.07))';
				s.color = 'var(--vscode-foreground, #e0e0e0)';
			});
			btn.addEventListener('mouseleave', () => {
				s.backgroundColor = 'transparent';
				s.color = 'var(--vscode-descriptionForeground, #999)';
			});
		}
		return btn;
	}

	private _makeSep(): HTMLElement {
		const sep = $('div.axon-sel-sep');
		const s = sep.style;
		s.setProperty('display', 'inline-block', 'important');
		s.setProperty('flex', '0 0 auto', 'important');
		s.setProperty('width', '1px', 'important');
		s.setProperty('height', '14px', 'important');
		s.backgroundColor = 'var(--vscode-widget-border, rgba(128,128,128,0.18))';
		s.margin = '0 2px';
		return sep;
	}

	/** 绑定 mousedown 动作 + 阻断冒泡 */
	private _bindAction(btn: HTMLElement, fn: () => void): void {
		btn.addEventListener('mousedown', (e) => {
			e.preventDefault();
			e.stopPropagation();
			fn();
		});
		btn.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); });
		btn.addEventListener('mouseup', (e) => { e.preventDefault(); e.stopPropagation(); });
	}

	getId(): string { return AxonSelectionActionBar.ID; }
	getDomNode(): HTMLElement { return this._domNode; }
	setPosition(position: IContentWidgetPosition | null): void { this._position = position; }
	getPosition(): IContentWidgetPosition | null { return this._position; }
	/** VS Code 调用此方法获取 widget 的首选宽度（覆盖默认的 0 宽度约束） */
	afterRender(): void {
		// 确保外层容器不约束我们的 flex 布局
		const parent = this._domNode.parentElement;
		if (parent) {
			parent.style.width = 'max-content';
			parent.style.overflow = 'visible';
		}
	}
}

/** 缓存的选区数据 */
interface CachedSelection {
	text: string;
	fileName: string;
	startLine: number;
	startColumn: number;
	endLine: number;
	endColumn: number;
}

export class AxonAddSelectionToChatContribution extends Disposable implements IEditorContribution {
	static readonly ID = 'editor.contrib.axonAddSelectionToChat';

	private _widget: AxonSelectionActionBar | undefined;
	private _hideTimer: ReturnType<typeof setTimeout> | undefined;
	private _showTimer: ReturnType<typeof setTimeout> | undefined;
	private _cached: CachedSelection | undefined;

	constructor(
		private readonly _editor: ICodeEditor,
		@ICommandService private readonly _commandService: ICommandService,
	) {
		super();
		this._register(this._editor.onMouseUp(() => this._scheduleShow()));
		this._register(this._editor.onDidChangeCursorSelection((e) => {
			if (e.selection.isEmpty()) {
				this._hide();
			}
		}));
		this._register(this._editor.onDidChangeModel(() => this._hide()));
		this._register(this._editor.onDidScrollChange(() => this._hide()));
		// Esc 键关闭
		this._register(this._editor.onKeyDown((e) => {
			if (e.keyCode === 9 /* Escape */) this._hide();
		}));
	}

	/** 延迟弹出：选中后需静止一段时间才显示，快速选中+复制不会触发 */
	private _scheduleShow(): void {
		this._cancelSchedule();
		const selection = this._editor.getSelection();
		const model = this._editor.getModel();
		if (!selection || selection.isEmpty() || !model) {
			this._hide();
			return;
		}
		const text = model.getValueInRange(selection);
		if (!text.trim() || text.trim().length < MIN_SELECTION_LENGTH) {
			this._hide();
			return;
		}
		this._showTimer = setTimeout(() => {
			// 再次检查选区是否仍有效（用户可能在延迟期间取消了选区）
			const sel = this._editor.getSelection();
			if (!sel || sel.isEmpty()) return;
			this._show(sel.getStartPosition());
			this._cached = {
				text,
				fileName: model.uri.path.split('/').pop() || model.uri.path,
				startLine: selection.startLineNumber,
				startColumn: selection.startColumn,
				endLine: selection.endLineNumber,
				endColumn: selection.endColumn,
			};
		}, SHOW_DELAY);
	}

	private _cancelSchedule(): void {
		if (this._showTimer !== undefined) {
			clearTimeout(this._showTimer);
			this._showTimer = undefined;
		}
	}

	private _show(position: { lineNumber: number; column: number }): void {
		this._hide();
		this._widget = new AxonSelectionActionBar(
			() => this._addToChat(),
			(action) => this._quickAction(action),
		);
		this._widget.setPosition({
			position,
			preference: [ContentWidgetPositionPreference.ABOVE, ContentWidgetPositionPreference.BELOW],
		});
		this._editor.addContentWidget(this._widget);
		this._hideTimer = setTimeout(() => this._hide(), AUTO_HIDE_DELAY);
	}

	private _addToChat(): void {
		const cached = this._cached;
		this._hide();
		if (!cached || !cached.text.trim()) return;
		this._commandService.executeCommand(ADD_TO_CHAT_COMMAND_ID, {
			text: cached.text,
			fileName: cached.fileName,
			startLine: cached.startLine,
			startColumn: cached.startColumn,
			endLine: cached.endLine,
			endColumn: cached.endColumn,
		}).then(undefined, () => { /* 忽略 */ });
	}

	private _quickAction(action: string): void {
		const cached = this._cached;
		this._hide();
		if (!cached || !cached.text.trim()) return;
		const found = QUICK_ACTIONS.find((a) => a.action === action);
		if (!found) return;
		this._commandService.executeCommand(found.command, {
			text: cached.text,
			fileName: cached.fileName,
			startLine: cached.startLine,
			startColumn: cached.startColumn,
			endLine: cached.endLine,
			endColumn: cached.endColumn,
		}).then(undefined, () => { /* 忽略 */ });
	}

	private _hide(): void {
		this._cancelSchedule();
		if (this._hideTimer !== undefined) {
			clearTimeout(this._hideTimer);
			this._hideTimer = undefined;
		}
		if (this._widget) {
			this._editor.removeContentWidget(this._widget);
			this._widget = undefined;
		}
		this._cached = undefined;
	}

	override dispose(): void {
		this._hide();
		super.dispose();
	}
}

registerEditorContribution(AxonAddSelectionToChatContribution.ID, AxonAddSelectionToChatContribution, EditorContributionInstantiation.BeforeFirstInteraction);
