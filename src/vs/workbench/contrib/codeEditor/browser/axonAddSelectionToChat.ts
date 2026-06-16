/*---------------------------------------------------------------------------------------------
 *  Axon —— 编辑器选区「添加到对话」浮动按钮
 *
 *  在代码编辑器中选中文本并松开鼠标后，于选区上方浮出一个按钮；点击后把选中代码及其
 *  位置范围（行:列-行:列）通过命令 `axon.addEditorSelectionToChat` 交给 Axon 扩展，
 *  由其注入到对话输入框成为代码上下文芯片。
 *--------------------------------------------------------------------------------------------*/

import * as dom from '../../../../base/browser/dom.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { localize } from '../../../../nls.js';
import { ContentWidgetPositionPreference, ICodeEditor, IContentWidget, IContentWidgetPosition } from '../../../../editor/browser/editorBrowser.js';
import { EditorContributionInstantiation, registerEditorContribution } from '../../../../editor/browser/editorExtensions.js';
import { IEditorContribution } from '../../../../editor/common/editorCommon.js';
import { ICommandService } from '../../../../platform/commands/common/commands.js';

const $ = dom.$;

/** 触发注入的命令 id（由 Axon 扩展注册并处理）。 */
const ADD_TO_CHAT_COMMAND_ID = 'axon.addEditorSelectionToChat';

/** 按钮自动消失延迟（ms） */
const AUTO_HIDE_DELAY = 3000;

class AxonAddSelectionWidget implements IContentWidget {
	static readonly ID = 'axon.editor.addSelectionWidget';

	readonly allowEditorOverflow = true;
	readonly suppressMouseDown = true;

	private readonly _domNode: HTMLElement;
	private _position: IContentWidgetPosition | null = null;

	constructor(onAction: () => void) {
		this._domNode = $('div.axon-add-selection-widget');
		this._domNode.textContent = localize('axon.editor.addToChat', "添加到 Axon");
		const s = this._domNode.style;
		s.padding = '2px 8px';
		s.fontSize = '12px';
		s.lineHeight = '16px';
		s.borderRadius = '4px';
		s.cursor = 'pointer';
		s.userSelect = 'none';
		s.whiteSpace = 'nowrap';
		s.color = 'var(--vscode-button-foreground)';
		s.backgroundColor = 'var(--vscode-button-background)';
		s.border = '1px solid var(--vscode-button-border, transparent)';
		s.boxShadow = '0 2px 8px rgba(0, 0, 0, 0.28)';
		s.zIndex = '100';
		s.position = 'relative';
		// 动作绑在 mousedown：在编辑器因点击清空选区之前就触发，并阻断冒泡避免编辑器处理该事件
		this._domNode.addEventListener('mousedown', (e) => {
			e.preventDefault();
			e.stopPropagation();
			onAction();
		});
		// 阻断 click/mouseup 冒泡，避免编辑器额外处理
		this._domNode.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); });
		this._domNode.addEventListener('mouseup', (e) => { e.preventDefault(); e.stopPropagation(); });
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
		// 先显示（_show 内部会 _hide 清旧状态），再写入缓存——顺序不能反，否则缓存会被 _show 清掉
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
		this._widget = new AxonAddSelectionWidget(() => this._addToChat());
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
		// 命令由 Axon 扩展注册；扩展未激活时静默忽略
		this._commandService.executeCommand(ADD_TO_CHAT_COMMAND_ID, {
			text: cached.text,
			fileName: cached.fileName,
			startLine: cached.startLine,
			startColumn: cached.startColumn,
			endLine: cached.endLine,
			endColumn: cached.endColumn,
		}).then(undefined, () => { /* 忽略：命令不存在或扩展未就绪 */ });
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
