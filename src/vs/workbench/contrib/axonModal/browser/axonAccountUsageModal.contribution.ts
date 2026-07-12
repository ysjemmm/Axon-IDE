/*---------------------------------------------------------------------------------------------
 *  Axon account usage modal (workbench-level overlay)
 *--------------------------------------------------------------------------------------------*/

import './media/axonAccountUsageModal.css';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { IClipboardService } from '../../../../platform/clipboard/common/clipboardService.js';
import { CommandsRegistry } from '../../../../platform/commands/common/commands.js';
import { Registry } from '../../../../platform/registry/common/platform.js';
import { IWorkbenchContributionsRegistry, Extensions as WorkbenchExtensions, WorkbenchPhase } from '../../../common/contributions.js';

const SHOW_ACCOUNT_USAGE_MODAL_COMMAND = 'axon.showAccountUsageModal';
const UPDATE_ACCOUNT_USAGE_MODAL_COMMAND = 'axon.updateAccountUsageModal';

/** 四芒星 path（viewBox 0 0 24 24），更接近 Axon ✦ 标识 */
const STAR_PATH = 'M12 2 L14.4 9.6 L22 12 L14.4 14.4 L12 22 L9.6 14.4 L2 12 L9.6 9.6 Z';

interface AxonAccountUsageModalOptions {
	apiKey?: string;
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
	if (!Number.isFinite(n)) return '--';
	return Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
}

function maskApiKey(apiKey: string | undefined): string {
	const key = apiKey?.trim() || '';
	if (!key) return '';
	if (key.length <= 10) return `${key.slice(0, 2)}••••${key.slice(-2)}`;
	return `${key.slice(0, 7)}••••••••${key.slice(-6)}`;
}

class AxonAccountUsageModalContribution extends Disposable {
	private overlay: HTMLElement | undefined;
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
		name.textContent = 'Axon 官方';
		info.appendChild(name);
		const sub = document.createElement('div');
		sub.className = 'axon-modal-sub';
		sub.textContent = 'Provider: Axon 官方';
		info.appendChild(sub);
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

		const creditsValue = document.createElement('div');
		creditsValue.className = 'axon-modal-credits-value';
		this.creditsValue = creditsValue;
		body.appendChild(creditsValue);

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

		document.body.appendChild(overlay);
		this.overlay = overlay;
		overlay.focus();
	}

	private update(options?: AxonAccountUsageModalOptions): void {
		if (!this.creditsValue || !this.body || !this.error) return;
		if (options?.loading) {
			this.creditsValue.classList.add('loading');
			this.creditsValue.textContent = 'Loading latest usage...';
		} else {
			this.creditsValue.classList.remove('loading');
			this.creditsValue.textContent = `${formatUsed(options?.usage?.usedCredits)} used / ${formatLimit(options?.usage?.totalCredits)} covered in plan`;
		}

		if (options?.errorMessage) {
			this.error.textContent = `获取用量失败：${options.errorMessage}`;
			if (!this.error.parentElement) this.body.appendChild(this.error);
		} else {
			this.error.remove();
		}
	}

	private hide(): void {
		this.overlay?.remove();
		this.overlay = undefined;
		this.creditsValue = undefined;
		this.error = undefined;
		this.body = undefined;
	}

	override dispose(): void {
		this.hide();
		super.dispose();
	}
}

Registry.as<IWorkbenchContributionsRegistry>(WorkbenchExtensions.Workbench)
	.registerWorkbenchContribution(AxonAccountUsageModalContribution, WorkbenchPhase.AfterRestored);
