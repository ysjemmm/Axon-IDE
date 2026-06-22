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
		this._domNode = $('div.axon-add-selection-widget');
		const s = this._domNode.style;
		s.display = 'flex';
		s.gap = '5px';
		s.alignItems = 'center';
		s.padding = '1px';
		s.userSelect = 'none';
		s.whiteSpace = 'nowrap';
		s.zIndex = '100';

		// ── "添加到 Axon" 按钮（主按钮） ──
		const addBtn = $('div.axon-selection-btn.axon-selection-primary');
		addBtn.textContent = localize('axon.editor.addToChat', '添加到 Axon');
		this._styleButton(addBtn, true);
		addBtn.addEventListener('mousedown', (e) => {
			e.preventDefault();
			e.stopPropagation();
			onAddToChat();
		});
		addBtn.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); });
		addBtn.addEventListener('mouseup', (e) => { e.preventDefault(); e.stopPropagation(); });
		this._domNode.appendChild(addBtn);

		// ── 分隔线 ──
		const sep = $('div.axon-selection-sep');
		sep.style.width = '1px';
		sep.style.height = '16px';
		sep.style.backgroundColor = 'var(--vscode-button-border, rgba(128,128,128,0.3))';
		this._domNode.appendChild(sep);

		// ── 一键操作按钮 ──
		for (const qa of QUICK_ACTIONS) {
			const btn = $('div.axon-selection-btn ' + qa.cssClass);
			btn.textContent = qa.label;
			this._styleButton(btn, false);
			btn.addEventListener('mousedown', (e) => {
				e.preventDefault();
				e.stopPropagation();
				onQuickAction(qa.action);
			});
			btn.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); });
			btn.addEventListener('mouseup', (e) => { e.preventDefault(); e.stopPropagation(); });
			this._domNode.appendChild(btn);
		}
	}

	private _styleButton(btn: HTMLElement, primary: boolean): void {
		const s = btn.style;
		s.padding = '2px 8px';
		s.fontSize = '12px';
		s.lineHeight = '16px';
		s.borderRadius = '4px';
		s.cursor = 'pointer';
		s.display = 'inline-block';
		s.boxShadow = '0 2px 8px rgba(0, 0, 0, 0.28)';
		if (primary) {
			s.color = 'var(--vscode-button-foreground)';
			s.backgroundColor = 'var(--vscode-button-background)';
			s.border = '1px solid var(--vscode-button-border, transparent)';
		} else {
			s.color = 'var(--vscode-button-secondaryForeground)';
			s.backgroundColor = 'var(--vscode-button-secondaryBackground)';
			s.border = '1px solid var(--vscode-button-secondaryBorder, transparent)';
		}
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
