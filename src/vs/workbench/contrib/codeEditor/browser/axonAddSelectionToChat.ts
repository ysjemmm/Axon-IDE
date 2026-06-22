/*---------------------------------------------------------------------------------------------
 *  Axon —— 编辑器选区浮动按钮组
 *
 *  在代码编辑器中选中文本并松开鼠标后，于选区上方浮出一行按钮：
 *    [添加到 Axon] [解释] [找Bug] [测试] [重构]
 *  点击后把选中代码及其位置范围（行:列-行:列）通过对应命令交给 Axon 扩展处理。
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
const QUICK_ACTIONS: { action: string; label: string; command: string; cssClass: string }[] = [
	{ action: 'explain',   label: localize('axon.editor.explain', '解释'),    command: 'axon.quickExplain',   cssClass: 'axon-quick-explain' },
	{ action: 'findBug',   label: localize('axon.editor.findBug', '找Bug'),  command: 'axon.quickFindBug',   cssClass: 'axon-quick-findbug' },
	{ action: 'test',       label: localize('axon.editor.test', '测试'),     command: 'axon.quickTest',      cssClass: 'axon-quick-test' },
	{ action: 'refactor',  label: localize('axon.editor.refactor', '重构'),  command: 'axon.quickRefactor',  cssClass: 'axon-quick-refactor' },
];

/** 按钮自动消失延迟（ms） */
const AUTO_HIDE_DELAY = 3000;

class AxonAddSelectionWidget implements IContentWidget {
	static readonly ID = 'axon.editor.addSelectionWidget';

	readonly allowEditorOverflow = true;
	readonly suppressMouseDown = true;

	private readonly _domNode: HTMLElement;
	private _position: IContentWidgetPosition | null = null;

	constructor(
		onAddToChat: () => void,
		onQuickAction: (action: string) => void,
	) {
		// ── 容器：统一的圆角卡片（垂直布局） ──
		this._domNode = $('div.axon-add-selection-widget');
		const cs = this._domNode.style;
		cs.display = 'flex';
		cs.flexDirection = 'column';       // 垂直排列
		cs.borderRadius = '6px';
		cs.overflow = 'hidden';
		cs.boxShadow = '0 4px 12px rgba(0, 0, 0, 0.25)';
		cs.border = '1px solid var(--vscode-widget-border, rgba(128,128,128,0.25))';
		cs.backgroundColor = 'var(--vscode-editorWidget-background, #252526)';
		cs.backdropFilter = 'blur(8px)';
		cs.userSelect = 'none';
		cs.whiteSpace = 'nowrap';
		cs.zIndex = '100';
		cs.fontFamily = 'var(--vscode-font-family, system-ui)';
		cs.fontSize = '11.5px';

		// ── "添加到 Axon" 主按钮（左侧，主题色填充） ──
		const addBtn = $('div.axon-selection-btn-primary');
		addBtn.textContent = '✦ ' + localize('axon.editor.addToChat', '添加到 Axon');
		const as = addBtn.style;
		as.display = 'flex';
		as.alignItems = 'center';
		as.justifyContent = 'center';
		as.padding = '5px 12px';
		as.color = 'var(--vscode-button-foreground, #ffffff)';
		as.backgroundColor = 'var(--vscode-button-background, #0e639c)';
		as.cursor = 'pointer';
		as.fontWeight = '600';
		as.transition = 'filter 0.15s';
		addBtn.addEventListener('mouseenter', () => { addBtn.style.filter = 'brightness(1.15)'; });
		addBtn.addEventListener('mouseleave', () => { addBtn.style.filter = 'none'; });
		this._bindAction(addBtn, onAddToChat);
		this._domNode.appendChild(addBtn);

		// ── 四个快捷操作（下方，透明底 hover 高亮） ──
		for (const qa of QUICK_ACTIONS) {
			// 水平分隔线
			const sep = $('div.axon-selection-divider');
			sep.style.height = '1px';
			sep.style.backgroundColor = 'var(--vscode-widget-border, rgba(128,128,128,0.2))';
			sep.style.flexShrink = '0';
			this._domNode.appendChild(sep);

			const btn = $('div.axon-selection-btn-quick');
			btn.textContent = qa.label;
			const bs = btn.style;
			bs.display = 'flex';
			bs.alignItems = 'center';
			bs.justifyContent = 'center';
			bs.padding = '5px 12px';
			bs.color = 'var(--vscode-descriptionForeground, #cccccc)';
			bs.cursor = 'pointer';
			bs.transition = 'background-color 0.15s, color 0.15s';
			btn.addEventListener('mouseenter', () => {
				btn.style.backgroundColor = 'var(--vscode-list-hoverBackground, rgba(255,255,255,0.08))';
				btn.style.color = 'var(--vscode-foreground, #ffffff)';
			});
			btn.addEventListener('mouseleave', () => {
				btn.style.backgroundColor = 'transparent';
				btn.style.color = 'var(--vscode-descriptionForeground, #cccccc)';
			});
			this._bindAction(btn, () => onQuickAction(qa.action));
			this._domNode.appendChild(btn);
		}
	}

	/** 绑定 mousedown 动作 + 阻断冒泡（点击瞬间编辑器可能清空选区，必须在 mousedown 就拿数据） */
	private _bindAction(btn: HTMLElement, fn: () => void): void {
		btn.addEventListener('mousedown', (e) => {
			e.preventDefault();
			e.stopPropagation();
			fn();
		});
		btn.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); });
		btn.addEventListener('mouseup', (e) => { e.preventDefault(); e.stopPropagation(); });
	}

	getId(): string { return AxonAddSelectionWidget.ID; }
	getDomNode(): HTMLElement { return this._domNode; }
	setPosition(position: IContentWidgetPosition | null): void { this._position = position; }
	getPosition(): IContentWidgetPosition | null { return this._position; }
}

/** 缓存的选区数据（show 时快照，点击时使用，避免点击瞬间选区被编辑器清空） */
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

	private _widget: AxonAddSelectionWidget | undefined;
	private _hideTimer: ReturnType<typeof setTimeout> | undefined;
	/** show 时快照的选区数据，点击时直接用（规避点击时选区被清空的时序问题） */
	private _cached: CachedSelection | undefined;

	constructor(
		private readonly _editor: ICodeEditor,
		@ICommandService private readonly _commandService: ICommandService,
	) {
		super();
		this._register(this._editor.onMouseUp(() => this._onMouseUp()));
		this._register(this._editor.onDidChangeCursorSelection((e) => {
			if (e.selection.isEmpty()) {
				this._hide();
			}
		}));
		this._register(this._editor.onDidChangeModel(() => this._hide()));
		this._register(this._editor.onDidScrollChange(() => this._hide()));
	}

	private _onMouseUp(): void {
		const selection = this._editor.getSelection();
		const model = this._editor.getModel();
		if (!selection || selection.isEmpty() || !model) {
			this._hide();
			return;
		}
		const text = model.getValueInRange(selection);
		if (!text.trim()) {
			this._hide();
			return;
		}
		this._show(selection.getStartPosition());
		this._cached = {
			text,
			fileName: model.uri.path.split('/').pop() || model.uri.path,
			startLine: selection.startLineNumber,
			startColumn: selection.startColumn,
			endLine: selection.endLineNumber,
			endColumn: selection.endColumn,
		};
	}

	private _show(position: { lineNumber: number; column: number }): void {
		this._hide();
		this._widget = new AxonAddSelectionWidget(
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
		if (!cached || !cached.text.trim()) {
			return;
		}
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
		if (!cached || !cached.text.trim()) {
			return;
		}
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
