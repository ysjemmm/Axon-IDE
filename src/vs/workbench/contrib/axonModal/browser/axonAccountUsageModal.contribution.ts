/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// allow-any-unicode-comment-file

// Axon account usage modal (workbench-level overlay)

import './media/axonAccountUsageModal.css';
import { mainWindow } from '../../../../base/browser/window.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { IClipboardService } from '../../../../platform/clipboard/common/clipboardService.js';
import { CommandsRegistry } from '../../../../platform/commands/common/commands.js';
import { registerWorkbenchContribution2, WorkbenchPhase } from '../../../common/contributions.js';

const SHOW_ACCOUNT_USAGE_MODAL_COMMAND = 'axon.showAccountUsageModal';
const UPDATE_ACCOUNT_USAGE_MODAL_COMMAND = 'axon.updateAccountUsageModal';

/** 四芒星 path（viewBox 0 0 24 24），更接近 Axon ✦ 标识 */
const STAR_PATH = 'M12 2 L14.4 9.6 L22 12 L14.4 14.4 L12 22 L9.6 14.4 L2 12 L9.6 9.6 Z';

/** 一行用量指标（扩展端已格式化好，这里只管排版） */
interface AxonUsageRow {
	label: string;
	value: string;
	detail?: string;
	/** 0~100，有总额的指标才有，用来画进度条 */
	percent?: number;
}

interface AxonAccountUsageModalOptions {
	apiKey?: string;
	/** 当前 Provider 的名字；旧版扩展不传时显示 Axon 官方 */
	title?: string;
	/** 全部指标（余额、订阅额度……）；有它就按行显示，没有就退回旧的 Credits 一行 */
	rows?: AxonUsageRow[];
	/** 例如「1 分钟前更新」 */
	updatedText?: string;
	usage?: { usedCredits?: number; totalCredits?: number; updatedAt?: number | null };
	errorMessage?: string;
	loading?: boolean;
}

function formatUsed(value: unknown): string {
	const n = typeof value === 'number' ? value : Number(value);
	return Number.isFinite(n) ? n.toFixed(2) : '--';
}

function formatLimit(value: unknown): string {
	const n = typeof value === 'number' ? value : Number(value);
	if (!Number.isFinite(n)) {
		return '--';
	}
	return Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
}

function maskApiKey(apiKey: string | undefined): string {
	const key = apiKey?.trim() || '';
	if (!key) {
		return '';
	}
	if (key.length <= 10) {
		return `${key.slice(0, 2)}••••${key.slice(-2)}`;
	}
	return `${key.slice(0, 7)}••••••••${key.slice(-6)}`;
}

class AxonAccountUsageModalContribution extends Disposable {
	private overlay: HTMLElement | undefined;
	private nameEl: HTMLElement | undefined;
	private subEl: HTMLElement | undefined;
	private creditsLabel: HTMLElement | undefined;
	private rowsEl: HTMLElement | undefined;
	private creditsValue: HTMLElement | undefined;
	private error: HTMLElement | undefined;
	private body: HTMLElement | undefined;

	constructor(
		@IClipboardService private readonly clipboardService: IClipboardService,
	) {
		super();
		this._register(CommandsRegistry.registerCommand(SHOW_ACCOUNT_USAGE_MODAL_COMMAND, (_accessor, options?: AxonAccountUsageModalOptions) => this.show(options)));
		this._register(CommandsRegistry.registerCommand(UPDATE_ACCOUNT_USAGE_MODAL_COMMAND, (_accessor, options?: AxonAccountUsageModalOptions) => this.update(options)));
	}

	private show(options?: AxonAccountUsageModalOptions): void {
		if (this.overlay) {
			return;
		}

		const overlay = document.createElement('div');
		overlay.className = 'axon-modal-overlay';
		overlay.setAttribute('role', 'dialog');
		overlay.setAttribute('aria-modal', 'true');
		overlay.tabIndex = -1;

		const card = document.createElement('div');
		card.className = 'axon-modal-card';
		card.addEventListener('click', (e) => e.stopPropagation());
		overlay.appendChild(card);

		const header = document.createElement('div');
		header.className = 'axon-modal-header';
		card.appendChild(header);

		const avatar = document.createElement('div');
		avatar.className = 'axon-modal-avatar';
		const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
		svg.setAttribute('viewBox', '0 0 24 24');
		svg.setAttribute('aria-hidden', 'true');
		const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
		path.setAttribute('d', STAR_PATH);
		path.setAttribute('fill', 'currentColor');
		svg.appendChild(path);
		avatar.appendChild(svg);
		header.appendChild(avatar);

		const info = document.createElement('div');
		info.className = 'axon-modal-info';
		const name = document.createElement('div');
		name.className = 'axon-modal-name';
		// allow-any-unicode-next-line
		name.textContent = 'Axon 官方';
		info.appendChild(name);
		this.nameEl = name;
		const sub = document.createElement('div');
		sub.className = 'axon-modal-sub';
		// allow-any-unicode-next-line
		sub.textContent = 'Provider: Axon 官方';
		info.appendChild(sub);
		this.subEl = sub;
		header.appendChild(info);

		const closeBtn = document.createElement('button');
		closeBtn.className = 'axon-modal-close';
		closeBtn.textContent = 'Close';
		header.appendChild(closeBtn);

		const body = document.createElement('div');
		body.className = 'axon-modal-body';
		card.appendChild(body);
		this.body = body;

		const creditsLabel = document.createElement('div');
		creditsLabel.className = 'axon-modal-credits-label';
		creditsLabel.textContent = 'Credits';
		body.appendChild(creditsLabel);
		this.creditsLabel = creditsLabel;

		const creditsValue = document.createElement('div');
		creditsValue.className = 'axon-modal-credits-value';
		this.creditsValue = creditsValue;
		body.appendChild(creditsValue);

		// 多指标时替代上面的 Credits 一行；放在它后面，免得打乱旧格式的两列网格
		const rowsEl = document.createElement('div');
		rowsEl.className = 'axon-modal-rows';
		rowsEl.style.display = 'none';
		body.appendChild(rowsEl);
		this.rowsEl = rowsEl;

		const error = document.createElement('div');
		error.className = 'axon-modal-error';
		this.error = error;
		this.update(options);

		const apiKey = options?.apiKey?.trim() || '';
		const maskedKey = maskApiKey(apiKey);
		if (maskedKey) {
			const keyRow = document.createElement('div');
			keyRow.className = 'axon-modal-key-row';
			body.appendChild(keyRow);

			const keyInfo = document.createElement('div');
			keyInfo.className = 'axon-modal-key-info';
			keyRow.appendChild(keyInfo);

			const keyLabel = document.createElement('div');
			keyLabel.className = 'axon-modal-key-label';
			keyLabel.textContent = 'API Key';
			keyInfo.appendChild(keyLabel);

			const keyValue = document.createElement('div');
			keyValue.className = 'axon-modal-key-value';
			keyValue.textContent = maskedKey;
			keyInfo.appendChild(keyValue);

			const copyBtn = document.createElement('button');
			copyBtn.className = 'axon-modal-copy';
			copyBtn.textContent = 'Copy';
			copyBtn.addEventListener('click', async (event) => {
				event.stopPropagation();
				try {
					await this.clipboardService.writeText(apiKey);
					copyBtn.textContent = 'Copied';
					setTimeout(() => { copyBtn.textContent = 'Copy'; }, 1200);
				} catch {
					copyBtn.textContent = 'Failed';
					setTimeout(() => { copyBtn.textContent = 'Copy'; }, 1200);
				}
			});
			keyRow.appendChild(copyBtn);
		}

		const close = () => this.hide();
		overlay.addEventListener('click', close);
		closeBtn.addEventListener('click', close);

		const onKey = (e: KeyboardEvent) => {
			if (e.key === 'Escape') { close(); }
		};
		overlay.addEventListener('keydown', onKey);

		// 挂在主窗口上：与原先的全局 document 是同一个对象，这里只是显式写出来（multi-window lint）
		mainWindow.document.body.appendChild(overlay);
		this.overlay = overlay;
		overlay.focus();
	}

	private update(options?: AxonAccountUsageModalOptions): void {
		if (!this.creditsValue || !this.body || !this.error) {
			return;
		}
		const title = options?.title?.trim();
		if (title && this.nameEl && this.subEl) {
			this.nameEl.textContent = title;
			// allow-any-unicode-next-line
			this.subEl.textContent = options?.loading ? '正在刷新用量…' : (options?.updatedText || `Provider: ${title}`);
		}

		const rows = options?.rows?.length ? options.rows : undefined;
		if (rows && this.rowsEl && this.creditsLabel) {
			// 新版：每个指标一行（余额、订阅额度……），刷新期间先显示上一次的数据
			this.creditsLabel.style.display = 'none';
			this.creditsValue.style.display = 'none';
			this.rowsEl.style.display = '';
			this.renderRows(rows);
		} else {
			if (this.rowsEl && this.creditsLabel) {
				this.rowsEl.style.display = 'none';
				this.creditsLabel.style.display = '';
				this.creditsValue.style.display = '';
			}
			if (options?.loading) {
				this.creditsValue.classList.add('loading');
				this.creditsValue.textContent = 'Loading latest usage...';
			} else {
				this.creditsValue.classList.remove('loading');
				this.creditsValue.textContent = `${formatUsed(options?.usage?.usedCredits)} used / ${formatLimit(options?.usage?.totalCredits)} covered in plan`;
			}
		}

		if (options?.errorMessage) {
			// allow-any-unicode-next-line
			this.error.textContent = `获取用量失败：${options.errorMessage}`;
			if (!this.error.parentElement) {
				this.body.appendChild(this.error);
			}
		} else {
			this.error.remove();
		}
	}

	private renderRows(rows: AxonUsageRow[]): void {
		const container = this.rowsEl;
		if (!container) {
			return;
		}
		container.replaceChildren();
		for (const row of rows) {
			const item = document.createElement('div');
			item.className = 'axon-modal-row';

			const head = document.createElement('div');
			head.className = 'axon-modal-row-head';
			const label = document.createElement('span');
			label.className = 'axon-modal-row-label';
			label.textContent = row.label;
			const value = document.createElement('span');
			value.className = 'axon-modal-row-value';
			value.textContent = row.percent !== undefined ? `${row.value}  \u00b7  ${row.percent}%` : row.value;
			head.append(label, value);
			item.appendChild(head);

			if (row.percent !== undefined) {
				const bar = document.createElement('div');
				bar.className = 'axon-modal-row-bar';
				const fill = document.createElement('div');
				fill.className = 'axon-modal-row-fill';
				if (row.percent >= 90) {
					fill.classList.add('danger');
				} else if (row.percent >= 70) {
					fill.classList.add('warn');
				}
				fill.style.width = `${Math.max(1, Math.min(100, row.percent))}%`;
				bar.appendChild(fill);
				item.appendChild(bar);
			}

			if (row.detail) {
				const detail = document.createElement('div');
				detail.className = 'axon-modal-row-detail';
				detail.textContent = row.detail;
				item.appendChild(detail);
			}
			container.appendChild(item);
		}
	}

	private hide(): void {
		this.overlay?.remove();
		this.overlay = undefined;
		this.nameEl = undefined;
		this.subEl = undefined;
		this.creditsLabel = undefined;
		this.rowsEl = undefined;
		this.creditsValue = undefined;
		this.error = undefined;
		this.body = undefined;
	}

	override dispose(): void {
		this.hide();
		super.dispose();
	}
}

registerWorkbenchContribution2('workbench.contrib.axonAccountUsageModal', AxonAccountUsageModalContribution, WorkbenchPhase.AfterRestored);
