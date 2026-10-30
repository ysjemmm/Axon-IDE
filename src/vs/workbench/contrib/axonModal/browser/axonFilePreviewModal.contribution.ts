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
import { Disposable, DisposableStore } from '../../../../base/common/lifecycle.js';
import { Schemas } from '../../../../base/common/network.js';
import { CommandsRegistry, ICommandService } from '../../../../platform/commands/common/commands.js';
import { IOpenerService } from '../../../../platform/opener/common/opener.js';
import { registerWorkbenchContribution2, WorkbenchPhase } from '../../../common/contributions.js';
import { IWebviewService } from '../../webview/browser/webview.js';

const SHOW_FILE_PREVIEW_MODAL_COMMAND = 'axon.showFilePreviewModal';
const UPDATE_FILE_PREVIEW_MODAL_COMMAND = 'axon.updateFilePreviewModal';

type PreviewKind = 'html' | 'svg' | 'image' | 'video' | 'pdf' | 'text' | 'office' | 'diff' | 'unsupported';

interface AxonFilePreviewOptions {
	/** 展示用文件名 */
	name?: string;
	/** 绝对路径，用于「在编辑器中打开」 */
	path?: string;
	kind?: PreviewKind;
	/** 文本/HTML/SVG 为原文；image/video/pdf 为 base64 */
	content?: string;
	/** image / video 的 MIME */
	mime?: string;
	/** 左上角类型角标，如 XLSX */
	badge?: string;
	/** unsupported 时的说明文案 */
	message?: string;
	/** diff 模式：改动前文本（原稿快照转出的文本） */
	before?: string;
	/** diff 模式：改动后文本（现文件转出的文本） */
	after?: string;
	/** diff 模式：原稿快照目录（恢复原稿时回传给扩展） */
	snapshotDir?: string;
	/** diff 模式：是否显示「恢复原稿」按钮 */
	restorable?: boolean;
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
	/**
	 * HTML 预览用的 webview 及其事件监听。
	 * 和 blobUrls 一样按「一次预览」为单位：切换文件、关闭浮层、销毁贡献时统一释放，
	 * 否则连续点不同产物会一直攒 webview（每个都是一个独立渲染进程里的 iframe）。
	 */
	private htmlWebviewDisposables: DisposableStore | undefined;

	constructor(
		@ICommandService private readonly commandService: ICommandService,
		@IWebviewService private readonly webviewService: IWebviewService,
		@IOpenerService private readonly openerService: IOpenerService,
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

		// 在文件系统中打开：定位到该文件（产物目录里的成片常要被拷走 / 分享，
		// 在编辑器里打开成二进制标签页对这类文件没意义）。
		const revealBtn = mainWindow.document.createElement('button');
		revealBtn.className = 'axon-preview-btn';
		// allow-any-unicode-next-line
		revealBtn.textContent = '在文件系统中打开';
		revealBtn.addEventListener('click', () => {
			const target = this.currentPath;
			if (target) {
				// 同样交回扩展：系统文件管理器定位是宿主侧能力，workbench 不直接碰
				void this.commandService.executeCommand('axon.revealFileInOs', target);
			}
		});
		actions.appendChild(revealBtn);

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
		// 同理释放上一个 HTML 预览的 webview
		this.releaseHtmlWebview();

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
				this.bodyEl.appendChild(this.buildHtmlWebview(content, name));
				return;
			case 'svg':
				// image/svg+xml 而不是 text/html：浏览器会按图片渲染并自适应缩放，
				// 当成 HTML 时 SVG 没有显式宽高就只画出左上角一小块。
				this.bodyEl.appendChild(this.buildFrame(content, name, 'image/svg+xml'));
				return;
			case 'image':
				this.bodyEl.appendChild(this.buildImage(content, options?.mime, name));
				return;
			case 'video':
				this.bodyEl.appendChild(this.buildVideo(content, options?.mime, name));
				return;
			case 'pdf':
				this.bodyEl.appendChild(this.buildPdf(content, name));
				return;
			case 'office':
				this.bodyEl.appendChild(this.buildDoc(content));
				return;
			case 'diff':
				this.bodyEl.appendChild(this.buildDiff(options));
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

	/**
	 * Cowork 改动对比：左右两栏行级 diff。
	 *
	 * 行对齐用朴素双指针 + 有限窗口锚点搜索（LCS 对数千行的 Office 转出文本太重）：
	 * 相同行折叠为上下文行，不同行左右成对展示。办公文档的改动通常集中在
	 * 少数段落/单元格，这种对齐足够准确。
	 */
	private buildDiff(options?: AxonFilePreviewOptions): HTMLElement {
		const wrap = mainWindow.document.createElement('div');
		wrap.className = 'axon-preview-diff';

		const beforeLines = (options?.before || '').split(/\r?\n/);
		const afterLines = (options?.after || '').split(/\r?\n/);

		const rows: Array<{ type: 'same' | 'changed'; before?: string; after?: string }> = [];
		let i = 0;
		let j = 0;
		const WINDOW = 200;
		while (i < beforeLines.length || j < afterLines.length) {
			if (i < beforeLines.length && j < afterLines.length && beforeLines[i] === afterLines[j]) {
				rows.push({ type: 'same', before: beforeLines[i], after: afterLines[j] });
				i++;
				j++;
				continue;
			}
			let nextJ = -1;
			for (let k = j; k < Math.min(afterLines.length, j + WINDOW); k++) {
				if (i < beforeLines.length && beforeLines[i] === afterLines[k]) { nextJ = k; break; }
			}
			if (nextJ >= 0) {
				for (; j < nextJ; j++) rows.push({ type: 'changed', after: afterLines[j] });
				continue;
			}
			let nextI = -1;
			for (let k = i; k < Math.min(beforeLines.length, i + WINDOW); k++) {
				if (j < afterLines.length && beforeLines[k] === afterLines[j]) { nextI = k; break; }
			}
			if (nextI >= 0) {
				for (; i < nextI; i++) rows.push({ type: 'changed', before: beforeLines[i] });
				continue;
			}
			if (i < beforeLines.length && j < afterLines.length) {
				rows.push({ type: 'changed', before: beforeLines[i], after: afterLines[j] });
				i++;
				j++;
			} else if (i < beforeLines.length) {
				rows.push({ type: 'changed', before: beforeLines[i] });
				i++;
			} else {
				rows.push({ type: 'changed', after: afterLines[j] });
				j++;
			}
		}

		const changedCount = rows.filter((r) => r.type === 'changed').length;
		if (changedCount === 0) {
			const state = this.buildState('两个版本内容一致，没有发现改动');
			state.classList.add('axon-preview-diff-same');
			wrap.appendChild(state);
			return wrap;
		}

		const bar = mainWindow.document.createElement('div');
		bar.className = 'axon-preview-diff-bar';
		const summary = mainWindow.document.createElement('span');
		summary.textContent = `${changedCount} 处改动`;
		bar.appendChild(summary);
		if (options?.restorable && options?.path && options?.snapshotDir) {
			const restoreBtn = mainWindow.document.createElement('button');
			restoreBtn.className = 'axon-preview-btn axon-preview-diff-restore';
			// allow-any-unicode-next-line
			restoreBtn.textContent = '恢复原稿';
			restoreBtn.addEventListener('click', () => {
				const target = this.currentPath;
				const dir = options.snapshotDir;
				this.hide();
				if (target && dir) {
					void this.commandService.executeCommand('axon.restoreCoworkSnapshot', target, dir);
				}
			});
			bar.appendChild(restoreBtn);
		}
		wrap.appendChild(bar);

		const header = mainWindow.document.createElement('div');
		header.className = 'axon-preview-diff-header';
		const h1 = mainWindow.document.createElement('span');
		// allow-any-unicode-next-line
		h1.textContent = '原稿';
		const h2 = mainWindow.document.createElement('span');
		// allow-any-unicode-next-line
		h2.textContent = 'AI 修改后';
		header.appendChild(h1);
		header.appendChild(h2);
		wrap.appendChild(header);

		const body = mainWindow.document.createElement('div');
		body.className = 'axon-preview-diff-body';
		for (const row of rows) {
			const line = mainWindow.document.createElement('div');
			line.className = `axon-preview-diff-row axon-preview-diff-row--${row.type}`;
			const left = mainWindow.document.createElement('span');
			left.textContent = row.before ?? '';
			const right = mainWindow.document.createElement('span');
			right.textContent = row.after ?? '';
			line.appendChild(left);
			line.appendChild(right);
			body.appendChild(line);
		}
		wrap.appendChild(body);
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

	/**
	 * HTML 预览：用 VS Code 的 webview 承载，而不是 blob iframe。
	 *
	 * ── 为什么不能继续用 blob iframe ──
	 * blob 文档会继承 workbench 页面的 CSP（script-src 'self' 'unsafe-eval' blob:，没有
	 * 'unsafe-inline'）。实测：即使给 iframe 加上 allow-scripts，内联 <script> 仍被拦，
	 * 外部 CDN 脚本也被拦。而 AI 生成的网页原型几乎全是内联脚本 + CDN 库，
	 * 所以页面只能「看」不能「用」。要放开就得放宽整个 IDE 窗口的 CSP，代价不可接受。
	 *
	 * webview 是独立的 vscode-webview 源，有自己的 CSP（由我们在 HTML 里自己写），
	 * 放宽只作用于这一个预览，不影响 workbench。
	 *
	 * ── 安全边界（改之前先读）──
	 * 内容是模型刚生成的，按不可信代码对待：
	 * · localResourceRoots 为空：读不到用户磁盘上的任何文件；
	 * · connect-src 'none'：不能 fetch / XHR / WebSocket，页面里的数据只能是内联的。
	 *   代价是要调真实接口的原型会失败，这是有意的取舍——预览是看效果，不是运行服务；
	 * · form-action 'none' / frame-src 'none'：不能提交表单、不能嵌套外站页面；
	 * · script-src / style-src / img-src / font-src 放行 https:，让 CDN 上的库
	 *   （Tailwind、Chart.js、字体等）能正常加载——交互原型离不开它们。
	 *   这意味着页面能向 CDN 发起请求，不能向任意接口发请求。
	 */
	private buildHtmlWebview(content: string, name: string): HTMLElement {
		const wrap = mainWindow.document.createElement('div');
		wrap.className = 'axon-preview-webview';

		const store = new DisposableStore();
		this.htmlWebviewDisposables = store;

		const webview = store.add(this.webviewService.createWebviewElement({
			title: name,
			options: { disableServiceWorker: true },
			contentOptions: { allowScripts: true, allowForms: false, localResourceRoots: [] },
			extension: undefined,
		}));
		webview.mountTo(wrap, mainWindow);

		// 链接点击：webview 默认只上报事件、什么都不做。只放行 http(s)，
		// 挡掉 file: / command: 之类——产物里的链接不该能触发 IDE 命令或读本地文件。
		store.add(webview.onDidClickLink((href) => {
			try {
				const scheme = href.slice(0, href.indexOf(':')).toLowerCase();
				if (scheme === Schemas.http || scheme === Schemas.https) {
					void this.openerService.open(href, { openExternal: true });
				}
			} catch {
				// 链接解析失败就当没点
			}
		}));

		webview.setHtml(this.wrapHtmlDocument(content));
		return wrap;
	}

	/**
	 * 给产物 HTML 套上 CSP。
	 *
	 * 注入到 <head> 最前面：meta CSP 对其后的内容生效；放在内容之前，
	 * 才能保证产物自己写的 <meta> 或脚本没机会先于它执行。
	 * 产物若不是完整文档（没有 <head>），就整体包进一个标准文档里。
	 */
	private wrapHtmlDocument(content: string): string {
		const csp = [
			`default-src 'none'`,
			`script-src 'unsafe-inline' 'unsafe-eval' https:`,
			`style-src 'unsafe-inline' https:`,
			`img-src data: blob: https:`,
			`font-src data: https:`,
			`media-src data: blob: https:`,
			`connect-src 'none'`,
			`frame-src 'none'`,
			`form-action 'none'`,
		].join('; ');
		const meta = `<meta http-equiv="Content-Security-Policy" content="${csp}">`;

		if (/<head[\s>]/i.test(content)) {
			return content.replace(/<head([^>]*)>/i, `<head$1>${meta}`);
		}
		return `<!doctype html><html><head><meta charset="utf-8">${meta}</head><body>${content}</body></html>`;
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
	 * 视频预览：借用 HTML webview 通道，把视频以 data URI 内嵌进一个只有 <video> 的页面。
	 *
	 * 不能直接在 workbench 里放 <video>：workbench 的 CSP 是 media-src 'self'，
	 * 既不放行 blob: 也不放行 data:（PDF 靠 frame-src 里的 blob: 才行，媒体没有对应放行）。
	 * 放宽整个 IDE 窗口的 CSP 代价不可接受，而 HTML 预览用的 webview 有自己独立的 CSP，
	 * 其中 media-src 已含 data:/blob:（见 wrapHtmlDocument），不用动任何安全策略。
	 *
	 * mime 只放行白名单里的两种，避免把任意字符串拼进 HTML 属性。
	 */
	private buildVideo(base64: string, mime: string | undefined, name: string): HTMLElement {
		const safeMime = mime === 'video/webm' ? 'video/webm' : 'video/mp4';
		// base64 字符集只有 [A-Za-z0-9+/=]，这里再过滤一遍，确保拼进 HTML 的内容不可能带出标签或引号
		const safeData = base64.replace(/[^A-Za-z0-9+/=]/g, '');
		const html = `<!doctype html><html><head><meta charset="utf-8"><style>` +
			`html,body{margin:0;height:100%;background:#000;display:flex;align-items:center;justify-content:center}` +
			`video{max-width:100%;max-height:100%}</style></head><body>` +
			`<video controls autoplay loop playsinline src="data:${safeMime};base64,${safeData}"></video>` +
			`</body></html>`;
		return this.buildHtmlWebview(html, name);
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
		this.releaseHtmlWebview();
		this.overlay?.remove();
		this.overlay = undefined;
		this.titleEl = undefined;
		this.badgeEl = undefined;
		this.bodyEl = undefined;
		this.currentPath = undefined;
	}

	private releaseHtmlWebview(): void {
		this.htmlWebviewDisposables?.dispose();
		this.htmlWebviewDisposables = undefined;
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
