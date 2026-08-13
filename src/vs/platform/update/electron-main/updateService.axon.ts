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
import * as path from '../../../base/common/path.js';
import { Emitter, Event } from '../../../base/common/event.js';
import { Disposable } from '../../../base/common/lifecycle.js';
import { CancellationToken, CancellationTokenSource } from '../../../base/common/cancellation.js';
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

// allow-any-unicode-next-line
/** 持久化已下载安装包路径（位于用户数据目录，重启后可恢复 Ready 状态） */
const LAST_DOWNLOADED_PACKAGE_FILE = 'last-downloaded-package.txt';

/** 下载进行中标记（记录 {url,targetPath}，重启后可识别中断的下载并清理） */
const LAST_DOWNLOADING_PACKAGE_FILE = 'last-downloading-package.txt';

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
	/** checkForUpdates 发现新版本后缓存的 update + asset，供 downloadUpdate 使用 */
	private pendingUpdate: { update: IUpdate; asset: IGitHubAsset } | undefined;
	/** 下载任务的 CancellationTokenSource，用于支持取消下载 */
	private downloadCancellationTokenSource: CancellationTokenSource | undefined;

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

		// 启动时检查是否有上次下载待安装的包，有则直接恢复 Ready 状态
		await this.tryRecoverDownloadedPackage();

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
				// 版本号相同 = 已经是最新版本，直接判定无需更新。
				//
				// 不再用 published_at 时间戳做"同版本增量更新"判断——那套机制有两个坑：
				// 1. 时间戳在【下载完成】时就写入（doDownload），而非【安装完成】后；用户下载后
				//    未安装/安装失败也会留下时间戳，语义错位。
				// 2. 时间戳文件存在 userDataPath 下，升级安装后若 userDataPath 变化（如安装到
				//    不同盘符）文件就"丢失"，getLastUpdateTimestamp() 返回 undefined，同版本也
				//    会被误判为"有新版本"→ 升级完成后打开依旧提示升级。
				// 版本号相同即已最新，与 isLatestVersion() 的 `<= 0` 判定保持一致。
				this.logService.info(`axon-update#checkForUpdates - same version (${currentVersion}), already latest`);
				this.setState(State.Idle(UpdateType.Setup, undefined, explicit || undefined));
				return;
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

			// 不自动下载：缓存 update + asset，设为 AvailableForDownload 状态，
			// 前端会显示通知 "发现新版本 vX.Y.Z，是否立即下载？"，用户确认后才下载。
			this.logService.info(`axon-update#checkForUpdates - update available, waiting for user confirmation to download`);
			this.pendingUpdate = { update, asset };
			this.setState(State.AvailableForDownload(update));
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
		// 下载到 userDataPath 而非 tmpdir：系统重启/磁盘清理后安装包不会丢失
		const cachePath = path.join(this.environmentMainService.userDataPath, 'axon-ide-update');
		await mkdir(cachePath, { recursive: true });

		const downloadPath = path.join(cachePath, asset.name);
		const totalBytes = asset.size;
		const startTime = Date.now();

		this.logService.info(`axon-update#doDownload - START url=${update.url} target=${downloadPath} size=${totalBytes}`);
		this.setState(State.Downloading(update, explicit, false, 0, totalBytes, startTime));

		// 写入"下载中"标记，即使中途崩溃/关机，下次启动也能识别并清理
		await this.saveDownloadingPackagePath(downloadPath, update.url!);

		// 创建 CancellationToken 用于支持取消下载
		this.downloadCancellationTokenSource = new CancellationTokenSource();
		const token = this.downloadCancellationTokenSource.token;

		try {
			const context = await this.requestService.request(
				{
					url: update.url!,
					headers: { 'User-Agent': `AxonIDE/${this.productService.version}` },
					callSite: 'axonUpdateService.download',
				},
				token,
			);

			let downloadedBytes = 0;
			const progressStream = transform<VSBuffer, VSBuffer>(
				context.stream,
				{
					data: data => {
						// 检查是否已取消
						if (token.isCancellationRequested) {
							throw new Error('Download cancelled');
						}
						downloadedBytes += data.byteLength;
						this.setState(State.Downloading(update, explicit, false, downloadedBytes, totalBytes, startTime));
						return data;
					}
				},
				chunks => VSBuffer.concat(chunks),
			);

			await this.fileService.writeFile(URI.file(downloadPath), progressStream);

			this.downloadedPackagePath = downloadPath;
			// allow-any-unicode-next-line
			// 持久化下载路径：即使关闭 IDE 再重启，也能恢复到 Ready 状态
			await this.saveDownloadedPackagePath(downloadPath);
			// 清除"下载中"标记——下载已完整完成
			await this.clearDownloadingPackagePath();
			this.logService.info(`axon-update#doDownload - persisted path: ${downloadPath}`);

			this.setState(State.Ready(update, explicit, false));

		// allow-any-unicode-next-line
			// 记录本次 release 的时间戳，用于同版本增量更新判断
			if (this.lastFetchedPublishedAt) {
				await this.saveLastUpdateTimestamp(this.lastFetchedPublishedAt);
			}

			this.logService.info(`axon-update#doDownload - complete: ${downloadPath}`);
		} catch (err) {
			// 下载失败时也清除进度标记
			await this.clearDownloadingPackagePath();
			if (token.isCancellationRequested) {
				this.logService.info('axon-update#doDownload - cancelled by user');
				this.setState(State.Idle(UpdateType.Setup));
			} else {
				this.logService.error('axon-update#doDownload - failed', err);
				this.setState(State.Idle(UpdateType.Setup, explicit ? 'Download failed' : undefined));
			}
		} finally {
			this.downloadCancellationTokenSource = undefined;
		}
	}

	cancelDownload(): void {
		if (this.downloadCancellationTokenSource) {
			this.logService.info('axon-update#cancelDownload - cancelling download');
			this.downloadCancellationTokenSource.cancel();
		}
	}

	async downloadUpdate(explicit: boolean): Promise<void> {
		// checkForUpdates 发现新版本后会缓存 pendingUpdate 并设为 AvailableForDownload 状态。
		// 用户点"Download Update"后调到这里，取出缓存开始下载。
		if (!this.pendingUpdate) {
			this.logService.warn('axon-update#downloadUpdate - no pending update (did checkForUpdates find one?)');
			return;
		}
		const { update, asset } = this.pendingUpdate;
		this.pendingUpdate = undefined; // 消费后清除
		await this.doDownload(update, asset, explicit);
	}

	async applyUpdate(): Promise<void> {
		// For Inno Setup installers, state goes directly to Ready after download.
		// User triggers quitAndInstall to apply.
	}

	async quitAndInstall(): Promise<void> {
		// 优先用内存中的路径，fallback 到持久化的缓存路径
		const pkgPath = this.downloadedPackagePath || this.getCachedDownloadedPackagePath();
		if (this._state.type !== StateType.Ready || !pkgPath) {
			return;
		}

		if (!existsSync(pkgPath)) {
			this.logService.error('axon-update#quitAndInstall - package file missing');
			this.setState(State.Idle(UpdateType.Setup, 'Installer file not found'));
			return;
		}

		this.logService.info(`axon-update#quitAndInstall - launching: ${pkgPath}`);

		const platform = process.platform;

		if (platform === 'win32') {
			// Windows: silent Inno Setup installer
			spawn(pkgPath, ['/silent', '/log', '/nocloseapplications', '/mergetasks=runcode,!desktopicon,!quicklaunchicon'], {
				detached: true,
				stdio: ['ignore', 'ignore', 'ignore'],
				env: { ...process.env, __COMPAT_LAYER: 'RunAsInvoker' },
			});
		} else if (platform === 'darwin') {
			// macOS: open the dmg for the user to drag-install
			spawn('open', [pkgPath], { detached: true, stdio: 'ignore' });
		} else {
			// Linux: open the download directory
			spawn('xdg-open', [path.dirname(pkgPath)], { detached: true, stdio: 'ignore' });
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
	// ── 持久化：下载路径 & 同版本时间戳 ──────────────────────────────────

	private getDownloadedPackageCachePath(): string {
		return path.join(this.environmentMainService.userDataPath, LAST_DOWNLOADED_PACKAGE_FILE);
	}

	private getCachedDownloadedPackagePath(): string | undefined {
		try {
			const p = this.getDownloadedPackageCachePath();
			if (!existsSync(p)) return undefined;
			const raw = require('fs').readFileSync(p, 'utf-8').trim();
			return raw || undefined;
		} catch {
			return undefined;
		}
	}

	private async saveDownloadedPackagePath(pkgPath: string): Promise<void> {
		try {
			await writeFile(this.getDownloadedPackageCachePath(), pkgPath, 'utf-8');
		} catch (err) {
			this.logService.error('axon-update#saveDownloadedPackagePath - failed', err);
		}
	}

	private async clearDownloadedPackagePath(): Promise<void> {
		try {
			const p = this.getDownloadedPackageCachePath();
			if (existsSync(p)) {
				const fs = require('fs/promises');
				await fs.unlink(p);
			}
		} catch { /* ignore */ }
	}

	// ── 下载进度标记（识别中断的下载） ──

	private getDownloadingPackageCachePath(): string {
		return path.join(this.environmentMainService.userDataPath, LAST_DOWNLOADING_PACKAGE_FILE);
	}

	private getCachedDownloadingPackagePath(): string | undefined {
		try {
			const p = this.getDownloadingPackageCachePath();
			if (!existsSync(p)) return undefined;
			const raw = require('fs').readFileSync(p, 'utf-8').trim();
			return raw || undefined;
		} catch {
			return undefined;
		}
	}

	private async saveDownloadingPackagePath(pkgPath: string, url: string): Promise<void> {
		try {
			await writeFile(this.getDownloadingPackageCachePath(), JSON.stringify({ path: pkgPath, url }), 'utf-8');
		} catch (err) {
			this.logService.error('axon-update#saveDownloadingPackagePath - failed', err);
		}
	}

	private async clearDownloadingPackagePath(): Promise<void> {
		try {
			const p = this.getDownloadingPackageCachePath();
			if (existsSync(p)) {
				const fs = require('fs/promises');
				await fs.unlink(p);
			}
		} catch { /* ignore */ }
	}

	/** 清理上次异常中断的下载残留文件 */
	private async cleanupInterruptedDownload(): Promise<void> {
		const progressRaw = this.getCachedDownloadingPackagePath();
		if (!progressRaw) return;

		let partialPath: string | undefined;
		try {
			const parsed = JSON.parse(progressRaw);
			partialPath = parsed.path;
		} catch { /* ignore */ }

		// 删除残留的不完整文件
		if (partialPath && existsSync(partialPath)) {
			try {
				const fs = require('fs/promises');
				await fs.unlink(partialPath);
				this.logService.info(`axon-update#cleanupInterruptedDownload - removed partial file: ${partialPath}`);
			} catch (err) {
				this.logService.error('axon-update#cleanupInterruptedDownload - failed to remove', err);
			}
		}

		// 清除进度标记
		await this.clearDownloadingPackagePath();
	}

	/** 启动时恢复：如果上次下载的安装包还在磁盘上，直接进入 Ready 状态 */
	private async tryRecoverDownloadedPackage(): Promise<void> {
		// 先检查是否有中断的下载（崩溃/异常关机残留）
		await this.cleanupInterruptedDownload();

		const cachedPath = this.getCachedDownloadedPackagePath();
		if (!cachedPath) return;

		if (!existsSync(cachedPath)) {
			// 包已被清理（如用户手动删除），清除残留记录
			this.logService.info(`axon-update#tryRecover - cached package gone: ${cachedPath}`);
			await this.clearDownloadedPackagePath();
			return;
		}

		this.logService.info(`axon-update#tryRecover - recovered package: ${cachedPath}`);
		this.downloadedPackagePath = cachedPath;
		// 构造简易 update 对象供 Ready 状态使用
		const recoveredUpdate: IUpdate = {
			version: `recovered-${Date.now()}`,
			productVersion: this.productService.version,
			url: cachedPath,
		};
		this.setState(State.Ready(recoveredUpdate, false, false));
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
