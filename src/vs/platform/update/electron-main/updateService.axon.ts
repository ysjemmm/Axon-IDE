/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Axon IDE — GitHub Releases Auto-Update Service
//
// Queries the GitHub Releases API directly for the latest version,
// downloads the platform-specific installer and applies it.
// Does not rely on VS Code's updateUrl / commit mechanism.

import { spawn } from 'child_process';
import { existsSync } from 'fs';
import { mkdir, readFile, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import * as path from '../../../base/common/path.js';
import { Emitter, Event } from '../../../base/common/event.js';
import { Disposable } from '../../../base/common/lifecycle.js';
import { CancellationToken } from '../../../base/common/cancellation.js';
import { VSBuffer } from '../../../base/common/buffer.js';
import { transform } from '../../../base/common/stream.js';
import { URI } from '../../../base/common/uri.js';
import { IConfigurationService } from '../../configuration/common/configuration.js';
import { IEnvironmentMainService } from '../../environment/electron-main/environmentMainService.js';
import { IFileService } from '../../files/common/files.js';
import { ILifecycleMainService, LifecycleMainPhase } from '../../lifecycle/electron-main/lifecycleMainService.js';
import { ILogService } from '../../log/common/log.js';
import { IProductService } from '../../product/common/productService.js';
import { IRequestService, asJson } from '../../request/common/request.js';
import { IUpdate, IUpdateService, State, StateType, UpdateType } from '../common/update.js';

/**
 * Subset of the GitHub Release Asset API response.
 */
interface IGitHubAsset {
	name: string;
	browser_download_url: string;
	size: number;
}

/**
 * Subset of the GitHub Release API response.
 */
interface IGitHubRelease {
	tag_name: string;
	name: string;
	assets: IGitHubAsset[];
	html_url: string;
	published_at: string;
	prerelease: boolean;
}

/** Strip leading 'v' prefix and build suffix from a tag to get a semver string. */
function parseVersion(tag: string): string {
	// v1.0.0-build.5 → 1.0.0
	return tag.replace(/^v/, '').split('-')[0];
}

/** Simple semver comparison: returns positive if a > b. */
function compareVersions(a: string, b: string): number {
	const pa = a.split('.').map(Number);
	const pb = b.split('.').map(Number);
	for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
		const na = pa[i] ?? 0;
		const nb = pb[i] ?? 0;
		if (na !== nb) {
			return na - nb;
		}
	}
	return 0;
}

/**
 * Find the appropriate installer asset for the current platform and architecture.
 */
function findPlatformAsset(assets: IGitHubAsset[]): IGitHubAsset | undefined {
	const platform = process.platform;
	const arch = process.arch;

	if (platform === 'win32') {
		// Windows: prefer Setup exe, fallback to portable zip
		return assets.find(a =>
			a.name.endsWith('.exe') &&
			a.name.toLowerCase().includes('win') &&
			(a.name.toLowerCase().includes('setup') || a.name.toLowerCase().includes('x64'))
		) ?? assets.find(a =>
			a.name.endsWith('.zip') &&
			a.name.toLowerCase().includes('win32') &&
			a.name.toLowerCase().includes('x64')
		);
	}

	if (platform === 'darwin') {
		// macOS: prefer dmg, fallback to zip
		const archKey = arch === 'arm64' ? 'arm64' : 'x64';
		return assets.find(a =>
			a.name.endsWith('.dmg') &&
			a.name.toLowerCase().includes(archKey)
		) ?? assets.find(a =>
			a.name.endsWith('.zip') &&
			a.name.toLowerCase().includes('darwin') &&
			a.name.toLowerCase().includes(archKey)
		);
	}

	if (platform === 'linux') {
		// Linux: tar.gz, AppImage, or deb
		return assets.find(a =>
			(a.name.endsWith('.tar.gz') || a.name.endsWith('.AppImage') || a.name.endsWith('.deb')) &&
			a.name.toLowerCase().includes('linux')
		);
	}

	return undefined;
}

// GitHub repository coordinates (matches reportIssueUrl in product.json)
const GITHUB_OWNER = 'ysjemmm';
const GITHUB_REPO = 'Axon-IDE';
const GITHUB_API_RELEASES_LATEST = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases?per_page=1`;

// allow-any-unicode-next-line
/** 本地记录的上次更新时间戳文件（位于用户数据目录） */
const LAST_UPDATE_TIMESTAMP_FILE = 'last-update-timestamp.txt';

export class AxonUpdateService extends Disposable implements IUpdateService {

	declare readonly _serviceBrand: undefined;

	private readonly _onStateChange = this._register(new Emitter<State>());
	readonly onStateChange: Event<State> = this._onStateChange.event;

	private _state: State = State.Uninitialized;
	get state(): State { return this._state; }

	private setState(state: State): void {
		this.logService.info('axon-update#setState', state.type);
		this._state = state;
		this._onStateChange.fire(state);
	}

	private downloadedPackagePath: string | undefined;

	// allow-any-unicode-next-line
	/** 最近一次 fetch 到的 release published_at，download 完成后写入本地时间戳文件 */
	private lastFetchedPublishedAt: string | undefined;

	constructor(
		@ILifecycleMainService private readonly lifecycleMainService: ILifecycleMainService,
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@IEnvironmentMainService private readonly environmentMainService: IEnvironmentMainService,
		@IRequestService private readonly requestService: IRequestService,
		@ILogService private readonly logService: ILogService,
		@IProductService private readonly productService: IProductService,
		@IFileService private readonly fileService: IFileService,
	) {
		super();

		this.lifecycleMainService.when(LifecycleMainPhase.AfterWindowOpen)
			.finally(() => this.initialize());
	}

	private async initialize(): Promise<void> {
		// Axon: enable auto-update in dev mode so we can test it.
		// The old isBuilt guard is removed — use update.mode=none to disable instead.
		const updateMode = this.configurationService.getValue<string>('update.mode');
		this.logService.info(`axon-update#initialize - update.mode=${updateMode}, isBuilt=${this.environmentMainService.isBuilt}`);
		if (updateMode === 'none') {
			this.logService.info('axon-update#initialize - updates disabled by user');
			this.setState(State.Idle(UpdateType.Setup));
			return;
		}

		this.setState(State.Idle(UpdateType.Setup));

		// Auto-check 30s after startup (unless manual mode)
		if (updateMode !== 'manual') {
			setTimeout(() => this.checkForUpdates(false), 30 * 1000);
		}
	}

	async checkForUpdates(explicit: boolean): Promise<void> {
		this.logService.info(`axon-update#checkForUpdates - START explicit=${explicit} state=${this._state.type}`);
		if (this._state.type !== StateType.Idle && this._state.type !== StateType.Uninitialized) {
			this.logService.info(`axon-update#checkForUpdates - SKIP: busy state=${this._state.type}`);
			return;
		}

		this.setState(State.CheckingForUpdates(explicit));

		try {
			const release = await this.fetchLatestRelease();

			if (!release) {
				this.logService.info('axon-update#checkForUpdates - no release available');
				this.setState(State.Idle(UpdateType.Setup, undefined, explicit || undefined));
				return;
			}

			const latestVersion = parseVersion(release.tag_name);
			const currentVersion = this.productService.version;

			this.logService.info(`axon-update#checkForUpdates - current: ${currentVersion}, latest: ${latestVersion}`);

			if (compareVersions(latestVersion, currentVersion) < 0) {
				// Current is newer than latest release (shouldn't normally happen)
				this.logService.info(`axon-update#checkForUpdates - current(${currentVersion}) is newer than latest(${latestVersion}), skipping`);
				this.setState(State.Idle(UpdateType.Setup, undefined, explicit || undefined));
				return;
			}

			if (compareVersions(latestVersion, currentVersion) === 0) {
				// Same version — check if release is newer than what was last installed
				const lastTs = this.getLastUpdateTimestamp();
				this.logService.info(`axon-update#checkForUpdates - same version, lastTs=${lastTs} publishedTs=${new Date(release.published_at).getTime()}`);
				if (lastTs && new Date(release.published_at).getTime() <= lastTs) {
					this.logService.info('axon-update#checkForUpdates - same version, no newer release');
					this.setState(State.Idle(UpdateType.Setup, undefined, explicit || undefined));
					return;
				}
				this.logService.info('axon-update#checkForUpdates - same version but release is newer, offering update');
			} else {
				this.logService.info(`axon-update#checkForUpdates - update available: ${currentVersion} -> ${latestVersion}`);
			}

			// Find installer asset for current platform
			const asset = findPlatformAsset(release.assets);
			if (!asset) {
				this.logService.warn(`axon-update#checkForUpdates - no matching asset. assets=[${release.assets?.map(a => a.name).join(', ')}] platform=${process.platform}-${process.arch}`);
				this.setState(State.Idle(UpdateType.Setup, 'No installer found for this platform', explicit || undefined));
				return;
			}

			this.logService.info(`axon-update#checkForUpdates - matched asset: ${asset.name} (${asset.size} bytes)`);

			const update: IUpdate = {
				version: release.tag_name,
				productVersion: latestVersion,
				url: asset.browser_download_url,
			};

		// allow-any-unicode-next-line
			// 记住本次 release 的时间戳，download 完成后写入本地
			this.lastFetchedPublishedAt = release.published_at;

			// Start download
			await this.doDownload(update, asset, explicit);
		} catch (err) {
			this.logService.error('axon-update#checkForUpdates - failed', err);
			const message = explicit ? (err instanceof Error ? err.message : String(err)) : undefined;
			this.setState(State.Idle(UpdateType.Setup, message));
		}
	}

	private async fetchLatestRelease(): Promise<IGitHubRelease | null> {
		const headers: Record<string, string> = {
			'Accept': 'application/vnd.github.v3+json',
			'User-Agent': `AxonIDE/${this.productService.version}`,
		};
		// allow-any-unicode-next-line
		// 优先读 product.json 里 CI 注入的 Token（最终用户零配置），
		// allow-any-unicode-next-line
		// 环境变量 AXON_GITHUB_TOKEN 作为本地开发覆盖
		const token = (this.productService as any).updateGitHubToken
			|| process.env['AXON_GITHUB_TOKEN']
			|| undefined;
		if (token) {
			headers['Authorization'] = `Bearer ${token}`;
		} else {
			this.logService.info('axon-update#fetchLatestRelease - no GitHub token configured; rate limit = 60 req/h per IP');
		}
		this.logService.info(`axon-update#fetchLatestRelease - fetching ${GITHUB_API_RELEASES_LATEST} hasToken=${!!token}`);

		const context = await this.requestService.request(
			{
				url: GITHUB_API_RELEASES_LATEST,
				headers,
				callSite: 'axonUpdateService.fetchLatestRelease',
			},
			CancellationToken.None,
		);

		const rateLimit = context.res.headers['x-ratelimit-remaining'];
		const rateLimitTotal = context.res.headers['x-ratelimit-limit'];
		this.logService.info(`axon-update#fetchLatestRelease - status=${context.res.statusCode} rateLimit=${rateLimit}/${rateLimitTotal}`);

		if (context.res.statusCode !== 200) {
			this.logService.error(`axon-update#fetchLatestRelease - unexpected status ${context.res.statusCode}`);
			throw new Error(`GitHub API returned ${context.res.statusCode}`);
		}

		const releases = await asJson<IGitHubRelease[]>(context);
		if (!Array.isArray(releases) || releases.length === 0) {
			this.logService.warn(`axon-update#fetchLatestRelease - no releases found on GitHub (releases type: ${typeof releases})`);
			return null;
		}

		const release = releases[0];
		this.logService.info(`axon-update#fetchLatestRelease - latest: ${release.tag_name} (published ${release.published_at}, prerelease=${release.prerelease})`);
		return release;
	}

	private async doDownload(update: IUpdate, asset: IGitHubAsset, explicit: boolean): Promise<void> {
		const cachePath = path.join(tmpdir(), 'axon-ide-update');
		await mkdir(cachePath, { recursive: true });

		const downloadPath = path.join(cachePath, asset.name);
		const totalBytes = asset.size;
		const startTime = Date.now();

		this.logService.info(`axon-update#doDownload - START url=${update.url} target=${downloadPath} size=${totalBytes}`);
		this.setState(State.Downloading(update, explicit, false, 0, totalBytes, startTime));

		try {
			const context = await this.requestService.request(
				{
					url: update.url!,
					headers: { 'User-Agent': `AxonIDE/${this.productService.version}` },
					callSite: 'axonUpdateService.download',
				},
				CancellationToken.None,
			);

			let downloadedBytes = 0;
			const progressStream = transform<VSBuffer, VSBuffer>(
				context.stream,
				{
					data: data => {
						downloadedBytes += data.byteLength;
						this.setState(State.Downloading(update, explicit, false, downloadedBytes, totalBytes, startTime));
						return data;
					}
				},
				chunks => VSBuffer.concat(chunks),
			);

			await this.fileService.writeFile(URI.file(downloadPath), progressStream);

			this.downloadedPackagePath = downloadPath;
			this.setState(State.Ready(update, explicit, false));

		// allow-any-unicode-next-line
			// 记录本次 release 的时间戳，用于同版本增量更新判断
			if (this.lastFetchedPublishedAt) {
				await this.saveLastUpdateTimestamp(this.lastFetchedPublishedAt);
			}

			this.logService.info(`axon-update#doDownload - complete: ${downloadPath}`);
		} catch (err) {
			this.logService.error('axon-update#doDownload - failed', err);
			this.setState(State.Idle(UpdateType.Setup, explicit ? 'Download failed' : undefined));
		}
	}

	async downloadUpdate(_explicit: boolean): Promise<void> {
		// Download is triggered inline during checkForUpdates; no-op here.
	}

	async applyUpdate(): Promise<void> {
		// For Inno Setup installers, state goes directly to Ready after download.
		// User triggers quitAndInstall to apply.
	}

	async quitAndInstall(): Promise<void> {
		if (this._state.type !== StateType.Ready || !this.downloadedPackagePath) {
			return;
		}

		if (!existsSync(this.downloadedPackagePath)) {
			this.logService.error('axon-update#quitAndInstall - package file missing');
			this.setState(State.Idle(UpdateType.Setup, 'Installer file not found'));
			return;
		}

		this.logService.info(`axon-update#quitAndInstall - launching: ${this.downloadedPackagePath}`);

		const platform = process.platform;

		if (platform === 'win32') {
			// Windows: silent Inno Setup installer
			spawn(this.downloadedPackagePath, ['/silent', '/log', '/nocloseapplications', '/mergetasks=runcode,!desktopicon,!quicklaunchicon'], {
				detached: true,
				stdio: ['ignore', 'ignore', 'ignore'],
				env: { ...process.env, __COMPAT_LAYER: 'RunAsInvoker' },
			});
		} else if (platform === 'darwin') {
			// macOS: open the dmg for the user to drag-install
			spawn('open', [this.downloadedPackagePath], { detached: true, stdio: 'ignore' });
		} else {
			// Linux: open the download directory
			spawn('xdg-open', [path.dirname(this.downloadedPackagePath)], { detached: true, stdio: 'ignore' });
		}

		// Quit the current application
		this.lifecycleMainService.quit(true);
	}

	async isLatestVersion(): Promise<boolean | undefined> {
		try {
			const release = await this.fetchLatestRelease();
			if (!release) {
				return undefined;
			}
			const latestVersion = parseVersion(release.tag_name);
			return compareVersions(latestVersion, this.productService.version) <= 0;
		} catch {
			return undefined;
		}
	}

	async _applySpecificUpdate(_packagePath: string): Promise<void> {
		// Not used
	}

	async setInternalOrg(_internalOrg: string | undefined): Promise<void> {
		// Not applicable
	}

	// allow-any-unicode-next-line
	// ── 同版本增量更新时间戳 ──────────────────────────────────────────────

	private getTimestampFilePath(): string {
		return path.join(this.environmentMainService.userDataPath, LAST_UPDATE_TIMESTAMP_FILE);
	}

	private getLastUpdateTimestamp(): number | undefined {
		try {
			const p = this.getTimestampFilePath();
			if (!existsSync(p)) return undefined;
			const raw = require('fs').readFileSync(p, 'utf-8').trim();
			const ts = Number(raw);
			return Number.isNaN(ts) ? undefined : ts;
		} catch {
			return undefined;
		}
	}

	private async saveLastUpdateTimestamp(publishedAt: string): Promise<void> {
		try {
			const ts = new Date(publishedAt).getTime();
			await writeFile(this.getTimestampFilePath(), String(ts), 'utf-8');
			this.logService.info(`axon-update#saveTimestamp - saved ${publishedAt} (${ts})`);
		} catch (err) {
			this.logService.error('axon-update#saveTimestamp - failed', err);
		}
	}
}
