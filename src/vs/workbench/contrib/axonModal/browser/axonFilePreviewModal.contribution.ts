/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// allow-any-unicode-comment-file

// Axon file preview modal (workbench-level overlay)
//
// 为什么做在外壳里而不是扩展的 webview 里：webview 的 DOM 永远被裁在它自己的边界内，
// 侧栏那条宽度放不下表格和网页（实测表格被挤成竖条）。workbench 级 overlay 挂在
// mainWindow.document.body 上，才能真正盖住整个 IDE 窗口。
//
// 扩展侧通过 executeCommand('axon.showFilePreviewModal', payload) 触发，
// 与已有的 axon.showAccountUsageModal 同一套机制。

import './media/axonFilePreviewModal.css';
import { mainWindow } from '../../../../base/browser/window.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { CommandsRegistry, ICommandService } from '../../../../platform/commands/common/commands.js';
import { registerWorkbenchContribution2, WorkbenchPhase } from '../../../common/contributions.js';

const SHOW_FILE_PREVIEW_MODAL_COMMAND = 'axon.showFilePreviewModal';
const UPDATE_FILE_PREVIEW_MODAL_COMMAND = 'axon.updateFilePreviewModal';

type PreviewKind = 'html' | 'svg' | 'image' | 'pdf' | 'text' | 'office' | 'unsupported';

interface AxonFilePreviewOptions {
	/** 展示用文件名 */
	name?: string;
	/** 绝对路径，用于「在编辑器中打开」 */
	path?: string;
	kind?: PreviewKind;
	/** 文本/HTML/SVG 为原文；image/pdf 为 base64 */
	content?: string;
	/** image 的 MIME */
	mime?: string;
	/** 左上角类型角标，如 XLSX */
	badge?: string;
	/** unsupported 时的说明文案 */
	message?: string;
	loading?: boolean;
}

class AxonFilePreviewModalContribution extends Disposable {
	private overlay: HTMLElement | undefined;
	private titleEl: HTMLElement | undefined;
	private badgeEl: HTMLElement | undefined;
	private bodyEl: HTMLElement | undefined;
	private currentPath: string | undefined;
	private keydownHandler: ((e: KeyboardEvent) => void) | undefined;
	/** 本次预览创建的 blob URL（PDF），关闭时统一释放 */
	private blobUrls: string[] = [];

	constructor(
		@ICommandService private readonly commandService: ICommandService,
	) {
		super();
		this._register(CommandsRegistry.registerCommand(SHOW_FILE_PREVIEW_MODAL_COMMAND, (_accessor, options?: AxonFilePreviewOptions) => this.show(options)));
		this._register(CommandsRegistry.registerCommand(UPDATE_FILE_PREVIEW_MODAL_COMMAND, (_accessor, options?: AxonFilePreviewOptions) => this.update(options)));
	}

	private show(options?: AxonFilePreviewOptions): void {
		// 已开着就只更新内容：连续点不同文件时不该叠出多层遮罩
		if (this.overlay) {
			this.update(options);
			return;
		}

		const overlay = mainWindow.document.createElement('div');
		overlay.className = 'axon-preview-overlay';
		overlay.setAttribute('role', 'dialog');
		overlay.setAttribute('aria-modal', 'true');
		overlay.tabIndex = -1;

		const card = mainWindow.document.createElement('div');
		card.className = 'axon-preview-card';
		// 阻止冒泡：点卡片内部不应触发遮罩的关闭
		card.addEventListener('click', (e) => e.stopPropagation());
		overlay.appendChild(card);

		const header = mainWindow.document.createElement('div');
		header.className = 'axon-preview-header';
		card.appendChild(header);

		const badge = mainWindow.document.createElement('span');
		badge.className = 'axon-preview-badge';
		header.appendChild(badge);
		this.badgeEl = badge;

		const title = mainWindow.document.createElement('div');
		title.className = 'axon-preview-title';
		header.appendChild(title);
		this.titleEl = title;

		const actions = mainWindow.document.createElement('div');
		actions.className = 'axon-preview-actions';
		header.appendChild(actions);

		// 在编辑器中打开：预览只读，想改内容得回到真正的编辑器
		const openBtn = mainWindow.document.createElement('button');
		openBtn.className = 'axon-preview-btn';
		// allow-any-unicode-next-line
		openBtn.textContent = '在编辑器中打开';
		openBtn.addEventListener('click', () => {
			const target = this.currentPath;
			this.hide();
			if (target) {
				// 交回扩展处理：workbench 侧不直接碰文件系统，由扩展用它已有的
				// showTextDocument 逻辑打开（路径解析、二进制判定都在那边）。
				void this.commandService.executeCommand('axon.openFileFromPreview', target);
			}
		});
		actions.appendChild(openBtn);

		const closeBtn = mainWindow.document.createElement('button');
		closeBtn.className = 'axon-preview-close';
		closeBtn.textContent = '\u00D7';
		// allow-any-unicode-next-line
		closeBtn.title = '关闭';
		closeBtn.addEventListener('click', () => this.hide());
		actions.appendChild(closeBtn);

		const body = mainWindow.document.createElement('div');
		body.className = 'axon-preview-body';
		card.appendChild(body);
		this.bodyEl = body;

		overlay.addEventListener('click', () => this.hide());

		// Esc 关闭：挂在 window 上而不是 overlay 上 —— iframe 拿到焦点后
		// overlay 收不到 keydown，Esc 就失效了
		this.keydownHandler = (e: KeyboardEvent) => {
			if (e.key === 'Escape') {
				e.stopPropagation();
				this.hide();
			}
		};
		mainWindow.addEventListener('keydown', this.keydownHandler, true);

		// ⚠️ 必须挂在 .monaco-workbench 内部，不能挂 document.body。
		//
		// --vscode-* 主题变量是注入到 .monaco-workbench 容器上的，不在 :root。
		// 挂到 body（workbench 的兄弟节点）会让变量继承链断掉，所有
		// background/color 解析失败 —— 表现就是整个浮层透明、底下的编辑器全透出来。
		// Credits 浮层挂 body 没事，因为它的配色是硬编码的。
		const host = mainWindow.document.querySelector('.monaco-workbench') ?? mainWindow.document.body;
		host.appendChild(overlay);
		this.overlay = overlay;
		overlay.focus();

		this.update(options);
	}

	private update(options?: AxonFilePreviewOptions): void {
		if (!this.bodyEl || !this.titleEl || !this.badgeEl) {
			return;
		}

		const name = options?.name || options?.path?.split(/[\\/]/).pop() || '';
		this.titleEl.textContent = name;
		this.titleEl.title = options?.path || name;
		this.currentPath = options?.path;

		const badge = options?.badge || '';
		this.badgeEl.textContent = badge;
		this.badgeEl.style.display = badge ? '' : 'none';

		// 整块替换而不是增量更新：预览内容各类型结构差异大，复用节点容易残留上一次的状态
		this.bodyEl.textContent = '';
		// 切换文件时先释放上一个 PDF 的 blob，不然连续预览会一直攒内存
		this.releaseBlobUrls();

		if (options?.loading) {
			this.bodyEl.appendChild(this.buildLoading());
			return;
		}

		const kind = options?.kind || 'unsupported';
		const content = options?.content || '';

		switch (kind) {
			case 'text':
				this.bodyEl.appendChild(this.buildText(content));
				return;
			case 'html':
				this.bodyEl.appendChild(this.buildFrame(content, name, 'text/html'));
				return;
			case 'svg':
				// image/svg+xml 而不是 text/html：浏览器会按图片渲染并自适应缩放，
				// 当成 HTML 时 SVG 没有显式宽高就只画出左上角一小块。
				this.bodyEl.appendChild(this.buildFrame(content, name, 'image/svg+xml'));
				return;
			case 'image':
				this.bodyEl.appendChild(this.buildImage(content, options?.mime, name));
				return;
			case 'pdf':
				this.bodyEl.appendChild(this.buildPdf(content, name));
				return;
			case 'office':
				this.bodyEl.appendChild(this.buildDoc(content));
				return;
			default:
				// allow-any-unicode-next-line
				this.bodyEl.appendChild(this.buildState(options?.message || '该文件类型不支持预览'));
				return;
		}
	}

	private buildLoading(): HTMLElement {
		const wrap = mainWindow.document.createElement('div');
		wrap.className = 'axon-preview-state';
		const spinner = mainWindow.document.createElement('div');
		spinner.className = 'axon-preview-spinner';
		wrap.appendChild(spinner);
		const text = mainWindow.document.createElement('span');
		// allow-any-unicode-next-line
		text.textContent = '正在加载预览';
		wrap.appendChild(text);
		return wrap;
	}

	private buildState(message: string): HTMLElement {
		const wrap = mainWindow.document.createElement('div');
		wrap.className = 'axon-preview-state';
		const text = mainWindow.document.createElement('span');
		text.textContent = message;
		wrap.appendChild(text);
		return wrap;
	}

	private buildText(content: string): HTMLElement {
		const pre = mainWindow.document.createElement('pre');
		pre.className = 'axon-preview-text';
		// textContent 而不是 innerHTML：文件内容是不可信输入，不能让它注入 DOM
		pre.textContent = content;
		return pre;
	}

	/**
	 * HTML / SVG 用 blob URL，不能用 srcdoc。
	 *
	 * srcdoc 的 iframe 源是 about:srcdoc，CSP 把它当【空源】——
	 * 报错里的 `Framing ''` 就是指这个空源。workbench 的策略是
	 * `frame-src 'self' vscode-webview: blob:`，空源不在白名单里，于是整个 iframe 被拦掉。
	 *
	 * ⚠️ blob: 是为此在 workbench.html / workbench-dev.html 的 frame-src 里显式加的
	 * （它不会被 'self' 自动涵盖）。安全前提是下面那行空 sandbox：iframe 处于
	 * opaque 源、不能执行脚本、拿不到父页面任何东西，所以放行 blob: 不扩大攻击面。
	 *
	 * sandbox 保持为空（不给 allow-scripts）：预览本地文件不该执行其中的脚本。
	 * 空 sandbox 同时意味着 iframe 处于独立的 opaque 源，拿不到父页面任何东西。
	 */
	private buildFrame(content: string, name: string, mime: string): HTMLElement {
		const frame = mainWindow.document.createElement('iframe');
		frame.className = 'axon-preview-frame';
		frame.title = name;
		frame.setAttribute('sandbox', '');
		const url = URL.createObjectURL(new Blob([content], { type: `${mime};charset=utf-8` }));
		this.blobUrls.push(url);
		frame.src = url;
		return frame;
	}

	private buildImage(base64: string, mime: string | undefined, name: string): HTMLElement {
		const wrap = mainWindow.document.createElement('div');
		wrap.className = 'axon-preview-image-wrap';
		const img = mainWindow.document.createElement('img');
		img.src = `data:${mime || 'image/png'};base64,${base64}`;
		img.alt = name;
		wrap.appendChild(img);
		return wrap;
	}

	/**
	 * PDF 用 blob URL，不能用 data URL。
	 *
	 * workbench 的 CSP 里 data: 不在 frame-src 白名单，
	 * iframe src 指向 data URL 会被直接拦掉（控制台报 "Framing '' violates ...
	 * frame-src" 并且内容区全白）。blob: 已在 workbench.html 的 frame-src 里放行。
	 */
	private buildPdf(base64: string, name: string): HTMLElement {
		const frame = mainWindow.document.createElement('iframe');
		frame.className = 'axon-preview-frame';
		frame.title = name;
		try {
			const binary = mainWindow.atob(base64);
			const bytes = new Uint8Array(binary.length);
			for (let i = 0; i < binary.length; i++) {
				bytes[i] = binary.charCodeAt(i);
			}
			const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
			// 关闭浮层时释放，避免一直占着内存
			this.blobUrls.push(url);
			frame.src = url;
		} catch {
			// allow-any-unicode-next-line
			return this.buildState('PDF 解码失败，无法预览');
		}
		return frame;
	}

	/**
	 * Office 文档：宿主转出的是轻量 Markdown（## 标题 + 管道表格 + 段落）。
	 * 这里只解析这三种结构，用 DOM API 构建 —— 不引 markdown 库、也不用 innerHTML。
	 */
	private buildDoc(content: string): HTMLElement {
		const wrap = mainWindow.document.createElement('div');
		wrap.className = 'axon-preview-doc';

		const lines = content.split(/\r?\n/);
		let index = 0;

		while (index < lines.length) {
			const line = lines[index];

			if (!line.trim()) {
				index++;
				continue;
			}

			// ## 标题（工作表名 / 幻灯片序号）
			if (line.startsWith('## ')) {
				const heading = mainWindow.document.createElement('h2');
				heading.textContent = line.slice(3).trim();
				wrap.appendChild(heading);
				index++;
				continue;
			}

			// > 备注（如「仅显示前 200 行」）
			if (line.startsWith('> ')) {
				const note = mainWindow.document.createElement('p');
				note.className = 'axon-preview-doc-note';
				note.textContent = line.slice(2).trim();
				wrap.appendChild(note);
				index++;
				continue;
			}

			// 管道表格：首行表头，次行分隔，之后为数据行
			if (line.startsWith('|')) {
				const rows: string[][] = [];
				// 有 |---|---| 分隔行才说明首行是表头。
				// Word 里两列的「字段名 | 值」键值表没有表头，首行当列名加粗会很怪。
				let hasHeader = false;
				while (index < lines.length && lines[index].startsWith('|')) {
					const raw = lines[index];
					index++;
					const cells = this.splitRow(raw);
					if (cells.every((c) => /^:?-{2,}:?$/.test(c.trim()))) {
						hasHeader = true;
						continue;
					}
					rows.push(cells);
				}
				if (rows.length > 0) {
					wrap.appendChild(this.buildTable(rows, hasHeader));
				}
				continue;
			}

			// 其余按段落处理，连续非空行合成一段
			const paragraph: string[] = [];
			while (index < lines.length && lines[index].trim() && !lines[index].startsWith('|') && !lines[index].startsWith('## ') && !lines[index].startsWith('> ')) {
				paragraph.push(lines[index]);
				index++;
			}
			const p = mainWindow.document.createElement('p');
			p.textContent = paragraph.join('\n');
			wrap.appendChild(p);
		}

		if (!wrap.hasChildNodes()) {
			// allow-any-unicode-next-line
			return this.buildState('文档内容为空');
		}
		return wrap;
	}

	/** 拆分 markdown 表格行，还原被转义的管道符 */
	private splitRow(raw: string): string[] {
		const trimmed = raw.replace(/^\|/, '').replace(/\|$/, '');
		const cells: string[] = [];
		let current = '';
		for (let i = 0; i < trimmed.length; i++) {
			const ch = trimmed[i];
			if (ch === '\\' && trimmed[i + 1] === '|') {
				current += '|';
				i++;
				continue;
			}
			if (ch === '|') {
				cells.push(current);
				current = '';
				continue;
			}
			current += ch;
		}
		cells.push(current);
		return cells.map((c) => c.trim());
	}

	private buildTable(rows: string[][], hasHeader: boolean): HTMLElement {
		const table = mainWindow.document.createElement('table');

		if (hasHeader) {
			const thead = mainWindow.document.createElement('thead');
			const headRow = mainWindow.document.createElement('tr');
			for (const cell of rows[0]) {
				const th = mainWindow.document.createElement('th');
				th.textContent = cell;
				headRow.appendChild(th);
			}
			thead.appendChild(headRow);
			table.appendChild(thead);
		}

		const tbody = mainWindow.document.createElement('tbody');
		for (let r = hasHeader ? 1 : 0; r < rows.length; r++) {
			const tr = mainWindow.document.createElement('tr');
			for (const cell of rows[r]) {
				const td = mainWindow.document.createElement('td');
				td.textContent = cell;
				tr.appendChild(td);
			}
			tbody.appendChild(tr);
		}
		table.appendChild(tbody);
		return table;
	}

	private hide(): void {
		if (this.keydownHandler) {
			mainWindow.removeEventListener('keydown', this.keydownHandler, true);
			this.keydownHandler = undefined;
		}
		this.releaseBlobUrls();
		this.overlay?.remove();
		this.overlay = undefined;
		this.titleEl = undefined;
		this.badgeEl = undefined;
		this.bodyEl = undefined;
		this.currentPath = undefined;
	}

	private releaseBlobUrls(): void {
		for (const url of this.blobUrls) {
			URL.revokeObjectURL(url);
		}
		this.blobUrls = [];
	}

	override dispose(): void {
		this.hide();
		super.dispose();
	}
}

registerWorkbenchContribution2('workbench.contrib.axonFilePreviewModal', AxonFilePreviewModalContribution, WorkbenchPhase.AfterRestored);
