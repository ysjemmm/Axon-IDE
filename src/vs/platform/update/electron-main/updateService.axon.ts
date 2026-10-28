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
import { mkdir, writeFile } from 'fs/promises';
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

/**
 * 最近一次「退出并安装」的记录（位于用户数据目录）。
 *
 * 「更新后重启又回到旧版本」这类问题验证代价极高：要真的走一遍下载、安装、重启。
 * 所以每次安装前留一条记录，下次启动时自检——版本没升上去、或者这次启动的根本不是被更新的那份
 * 安装，就立刻在标题栏的更新提示里说清楚，并写进日志。之后每一次真实用户的更新都在替我们验证。
 */
const LAST_INSTALL_ATTEMPT_FILE = 'last-install-attempt.json';

interface IInstallAttempt {
	/** 要装上的版本 */
	targetVersion: string;
	/** 安装前的版本 */
	fromVersion: string;
	/** 安装前正在运行的可执行文件：下次启动若换了路径，说明启动的是另一份安装 */
	execPath: string;
	/** 被覆盖的安装位置（Windows 为安装目录，macOS 为 .app 包） */
	installTarget: string;
	/** 安装日志 */
	logPath?: string;
	platform: string;
	at: string;
}

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

		// 先自检上一次安装是否真的生效；失败时把原因挂在更新提示上，这次不再静默恢复 Ready
		// （否则标题栏只剩一个「更新」按钮，用户不知道上一次其实没装上）
		const lastInstallFailed = await this.verifyLastInstall();

		// 启动时检查是否有上次下载待安装的包，有则直接恢复 Ready 状态
		if (!lastInstallFailed) {
			await this.tryRecoverDownloadedPackage();
		}

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
			await this.saveDownloadedPackagePath(downloadPath, update.productVersion);
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
		const pkgPath = this.downloadedPackagePath || this.getCachedDownloadedPackage()?.path;
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
		const readyUpdate = this._state.type === StateType.Ready ? this._state.update : undefined;
		const targetVersion = readyUpdate?.productVersion ?? this.getCachedDownloadedPackage()?.version ?? '';
		const logPath = path.join(path.dirname(pkgPath), `install-${targetVersion || 'unknown'}.log`);

		if (platform === 'win32') {
			// Windows: silent Inno Setup installer.
			//
			// ⚠️ 修复记录（用户反馈：关闭重开后又回到旧版本）：
			// ① 早先带了 /nocloseapplications，并且 spawn 完立刻同步调用 quit(true)：
			//    安装器可能在旧进程还占用着主 exe/dll 时就去写文件，/silent 下覆盖失败是静默的。
			//    现在交给 Inno Setup 自己的进程检测/等待（脚本里 CloseApplications=force）。
			// ② 没有指定 /DIR：安装位置全靠 Inno 去注册表找上一次的记录。PrivilegesRequired=lowest
			//    下更新安装器以普通用户运行，只查 HKCU；首次若是以管理员身份装到 Program Files
			//    （记录在 HKLM），就找不到，转而在 %LOCALAPPDATA%\Programs 另装一份——新版装上了，
			//    任务栏固定的、桌面上的快捷方式却还指向旧的那份，表现就是「重启后又回到旧版本」。
			//    现在显式指定为【当前正在运行的这份】的目录，更新只可能覆盖它。
			// ③ /mergetasks 里的 runcode / quicklaunchicon 是官方脚本的任务，axon-ide.iss 没有，去掉；
			//    装完自动重启改由脚本的 [Run]（Check: WizardSilent）负责。
			const installDir = path.dirname(process.execPath);
			const args = ['/silent', `/LOG=${logPath}`, '/mergetasks=!desktopicon'];
			// 开发态的 execPath 是 .build 下的 electron，不能当安装目录
			if (this.environmentMainService.isBuilt) {
				args.push(`/DIR=${installDir}`);
			}
			await this.saveInstallAttempt({ targetVersion, installTarget: installDir, logPath });

			const installer = spawn(pkgPath, args, {
				detached: true,
				stdio: ['ignore', 'ignore', 'ignore'],
				env: { ...process.env, __COMPAT_LAYER: 'RunAsInvoker' },
			});
			installer.unref();

			// 安装器进程本身起不来（如路径错误/权限问题）要能兜住并回退状态，
			// 而不是吞掉错误后仍然静默退出应用（那样用户会看到应用消失但更新完全没跑）。
			let installerFailed = false;
			installer.once('error', (err) => {
				installerFailed = true;
				this.logService.error('axon-update#quitAndInstall - failed to spawn installer', err);
				void this.clearInstallAttempt();
				this.setState(State.Idle(UpdateType.Setup, 'Failed to launch installer'));
			});

			// 给 installer 的 error 事件一点时间冒出来再决定是否退出：spawn 是异步的，
			// 紧接着同步 quit 会让上面这个 error 监听器完全来不及生效。
			setTimeout(() => {
				if (installerFailed) {
					return;
				}
				this.logService.info(`axon-update#quitAndInstall - installer launched (dir=${installDir}, log=${logPath}), quitting now`);
				this.lifecycleMainService.quit(true);
			}, 300);
			return;
		} else if (platform === 'darwin') {
			// macOS：早先只是 `open` 打开 dmg 就退出，拖进「应用程序」全靠用户。最常见的结果是用户直接在
			// dmg 窗口里双击打开——跑的是挂载卷上的新版，看起来更新成功了；dmg 一卸载、下次从 Dock 启动，
			// 打开的还是 /Applications 里那份从没被替换的旧版。现在自动替换当前这份 .app 再重启。
			const bundle = this.currentMacAppBundle();
			if (bundle && this.canReplace(bundle)) {
				await this.saveInstallAttempt({ targetVersion, installTarget: bundle, logPath });
				this.launchMacInstaller(pkgPath, bundle, logPath);
				this.lifecycleMainService.quit(true);
				return;
			}
			// 不能自动替换（开发态、在 dmg 里运行、目录没有写权限）：退回让用户手动拖拽
			this.logService.warn(`axon-update#quitAndInstall - cannot replace app bundle automatically (bundle=${bundle ?? 'unknown'}), opening package`);
			spawn('open', [pkgPath], { detached: true, stdio: 'ignore' });
		} else {
			// Linux: open the download directory
			spawn('xdg-open', [path.dirname(pkgPath)], { detached: true, stdio: 'ignore' });
		}

		// Quit the current application
		this.lifecycleMainService.quit(true);
	}

	/** 当前运行的 .app 包路径（…/Axon IDE.app）；开发态或不在 .app 里运行时返回 undefined */
	private currentMacAppBundle(): string | undefined {
		if (!this.environmentMainService.isBuilt) {
			return undefined;
		}
		const match = /^(.+?\.app)\/Contents\//.exec(process.execPath);
		if (!match) {
			return undefined;
		}
		// 在 dmg 挂载卷里运行：那里只读，也不是用户以后会启动的位置，装到「应用程序」
		if (match[1].startsWith('/Volumes/')) {
			return path.join('/Applications', path.basename(match[1]));
		}
		return match[1];
	}

	/** .app 所在目录可写，才能原地替换 */
	private canReplace(bundle: string): boolean {
		try {
			const fs = require('fs') as typeof import('fs');
			fs.accessSync(path.dirname(bundle), fs.constants.W_OK);
			if (existsSync(bundle)) {
				fs.accessSync(bundle, fs.constants.W_OK);
			}
			return true;
		} catch {
			return false;
		}
	}

	/**
	 * 起一个脱离本进程的 shell：等本进程退出 → 挂载 dmg（或解压 zip）→ 复制出新 .app →
	 * 与旧包原子交换 → 重新打开。任何一步失败都退回「打开安装包让用户手动拖拽」，并保留旧版。
	 * 输出写进 logPath，下次启动自检失败时会提示这个路径。
	 */
	private launchMacInstaller(pkgPath: string, bundle: string, logPath: string): void {
		const script = [
			'PID="$1"; PKG="$2"; TARGET="$3"; LOG="$4"',
			'exec >>"$LOG" 2>&1',
			'echo "[axon-update] $(date) install $PKG -> $TARGET"',
			'while kill -0 "$PID" 2>/dev/null; do sleep 0.5; done',
			'fail() { echo "[axon-update] FAILED: $1"; [ -n "$MNT" ] && hdiutil detach "$MNT" -force >/dev/null 2>&1; rm -rf "$TARGET.axon-new"; open "$PKG"; exit 1; }',
			'WORK=$(mktemp -d /tmp/axon-update.XXXXXX) || fail "mktemp"',
			'MNT=""',
			'case "$PKG" in',
			'  *.zip) ditto -x -k "$PKG" "$WORK" || fail "unzip"; SRCDIR="$WORK" ;;',
			'  *) hdiutil attach -nobrowse -noautoopen -readonly -mountpoint "$WORK" "$PKG" || fail "attach"; MNT="$WORK"; SRCDIR="$WORK" ;;',
			'esac',
			'SRC=$(find "$SRCDIR" -maxdepth 2 -name "*.app" -type d | head -n 1)',
			'[ -n "$SRC" ] || fail "no .app in package"',
			'rm -rf "$TARGET.axon-new"',
			'ditto "$SRC" "$TARGET.axon-new" || fail "copy"',
			'[ -n "$MNT" ] && hdiutil detach "$MNT" -force',
			'MNT=""',
			'rm -rf "$TARGET.axon-old"',
			'if [ -d "$TARGET" ]; then mv "$TARGET" "$TARGET.axon-old" || fail "move old"; fi',
			'if ! mv "$TARGET.axon-new" "$TARGET"; then [ -d "$TARGET.axon-old" ] && mv "$TARGET.axon-old" "$TARGET"; fail "swap"; fi',
			'rm -rf "$TARGET.axon-old" "$WORK"',
			'xattr -dr com.apple.quarantine "$TARGET" 2>/dev/null',
			'echo "[axon-update] done, relaunching"',
			'open "$TARGET"',
		].join('\n');
		// 参数走位置参数而不是拼进脚本：路径里的空格、引号都不用转义
		const child = spawn('/bin/sh', ['-c', script, 'axon-update', String(process.pid), pkgPath, bundle, logPath], {
			detached: true,
			stdio: 'ignore',
		});
		child.unref();
		this.logService.info(`axon-update#quitAndInstall - mac installer started (target=${bundle}, log=${logPath})`);
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

	/**
	 * 读取"已下载待安装"的记录。
	 *
	 * 记录里同时存该安装包对应的版本号——启动时靠它判断这个包是否还值得提示安装
	 * （见 tryRecoverDownloadedPackage）。兼容旧格式：早期只写了一行裸路径，没有版本号。
	 */
	private getCachedDownloadedPackage(): { path: string; version?: string } | undefined {
		try {
			const p = this.getDownloadedPackageCachePath();
			if (!existsSync(p)) return undefined;
			const raw = require('fs').readFileSync(p, 'utf-8').trim();
			if (!raw) return undefined;
			if (raw.startsWith('{')) {
				const parsed = JSON.parse(raw) as { path?: string; version?: string };
				if (!parsed.path) return undefined;
				return { path: parsed.path, version: parsed.version };
			}
			return { path: raw };
		} catch {
			return undefined;
		}
	}

	private async saveDownloadedPackagePath(pkgPath: string, version: string | undefined): Promise<void> {
		try {
			await writeFile(this.getDownloadedPackageCachePath(), JSON.stringify({ path: pkgPath, version }), 'utf-8');
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

	// ── 安装自检 ──

	private getInstallAttemptPath(): string {
		return path.join(this.environmentMainService.userDataPath, LAST_INSTALL_ATTEMPT_FILE);
	}

	private async saveInstallAttempt(params: { targetVersion: string; installTarget: string; logPath?: string }): Promise<void> {
		const record: IInstallAttempt = {
			...params,
			fromVersion: this.productService.version,
			execPath: process.execPath,
			platform: process.platform,
			at: new Date().toISOString(),
		};
		try {
			await writeFile(this.getInstallAttemptPath(), JSON.stringify(record), 'utf-8');
		} catch (err) {
			this.logService.error('axon-update#saveInstallAttempt - failed', err);
		}
	}

	private async clearInstallAttempt(): Promise<void> {
		try {
			const p = this.getInstallAttemptPath();
			if (existsSync(p)) {
				const fs = require('fs/promises');
				await fs.unlink(p);
			}
		} catch { /* ignore */ }
	}

	/**
	 * 启动自检：上一次「退出并安装」之后，这次启动的是不是新版本、是不是同一份安装。
	 * 记录只用一次（读完即删），结果写进日志；失败时设成带错误信息的 Idle，标题栏会弹出提示。
	 * @returns 上一次安装是否失败
	 */
	private async verifyLastInstall(): Promise<boolean> {
		let record: IInstallAttempt | undefined;
		try {
			const p = this.getInstallAttemptPath();
			if (!existsSync(p)) {
				return false;
			}
			record = JSON.parse(require('fs').readFileSync(p, 'utf-8')) as IInstallAttempt;
		} catch (err) {
			this.logService.warn(`axon-update#verifyLastInstall - unreadable record: ${(err as Error).message}`);
		}
		await this.clearInstallAttempt();
		if (!record?.targetVersion) {
			return false;
		}

		const current = this.productService.version;
		const samePath = process.platform === 'win32'
			? record.execPath.toLowerCase() === process.execPath.toLowerCase()
			: record.execPath === process.execPath;
		const upgraded = compareVersions(current, record.targetVersion) >= 0;
		this.logService.info(`axon-update#verifyLastInstall - target=${record.targetVersion} from=${record.fromVersion} current=${current} upgraded=${upgraded} samePath=${samePath} execPath=${process.execPath} previousExecPath=${record.execPath} log=${record.logPath ?? '-'}`);

		if (upgraded) {
			if (!samePath) {
				// 新版本跑起来了，但不是在原来那份安装上：旧的那份多半还在，快捷方式可能还指着它
				this.logService.warn(`axon-update#verifyLastInstall - upgraded, but running from a different location than before (${record.execPath} -> ${process.execPath}); an old copy may still exist`);
			}
			return false;
		}

		const message = samePath
			? `Update to ${record.targetVersion} did not take effect: still running ${current}.${record.logPath ? ` Installer log: ${record.logPath}` : ''}`
			: `Update to ${record.targetVersion} was installed to ${record.installTarget}, but this launch started another copy at ${process.execPath} (${current}). Launch Axon IDE from the updated location or remove the old copy.`;
		this.logService.error(`axon-update#verifyLastInstall - FAILED: ${message}`);
		this.setState(State.Idle(UpdateType.Setup, message));
		return true;
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

	/**
	 * 启动时恢复：仅当上次下载的安装包【确实比当前版本新】时，才恢复 Ready 状态。
	 *
	 * 为什么必须比对版本：安装完成后这条记录不会自己消失——安装器是独立进程，装完把本应用
	 * 重启，没人回来收拾记录。早先这里只要文件还在就无条件恢复 Ready，于是标题栏永远挂着
	 * Update 按钮，点它又把同一个安装包装一遍：用户看到的就是"已经升级到最新版，却还有一个
	 * Update 按钮"，而且每次启动都复现。
	 *
	 * 判据：记录里的版本 <= 当前版本 => 这个包要么已经装上、要么已经过期，清理掉即可。
	 * 旧格式记录（没有版本号）无法判断，一律按"已过期"处理：宁可让用户必要时重新下载一次，
	 * 也不要永久残留一个点不掉的更新提示。
	 */
	private async tryRecoverDownloadedPackage(): Promise<void> {
		// 先检查是否有中断的下载（崩溃/异常关机残留）
		await this.cleanupInterruptedDownload();

		const cached = this.getCachedDownloadedPackage();
		if (!cached) return;

		if (!existsSync(cached.path)) {
			// 包已被清理（如用户手动删除），清除残留记录
			this.logService.info(`axon-update#tryRecover - cached package gone: ${cached.path}`);
			await this.clearDownloadedPackagePath();
			return;
		}

		const target = cached.version;
		if (!target || compareVersions(target, this.productService.version) <= 0) {
			this.logService.info(`axon-update#tryRecover - discarding stale package (recorded=${target ?? 'unknown'}, current=${this.productService.version}): ${cached.path}`);
			await this.clearDownloadedPackagePath();
			// 安装包本体一并删掉，别让上百 MB 永久占着用户数据目录
			await this.deleteCachedPackageFile(cached.path);
			return;
		}

		this.logService.info(`axon-update#tryRecover - recovered package: ${cached.path} (${target})`);
		this.downloadedPackagePath = cached.path;
		// 构造简易 update 对象供 Ready 状态使用
		const recoveredUpdate: IUpdate = {
			version: `v${target}`,
			productVersion: target,
			url: cached.path,
		};
		this.setState(State.Ready(recoveredUpdate, false, false));
	}

	/** 删除已下载的安装包文件（best-effort：删不掉只记日志，不影响启动） */
	private async deleteCachedPackageFile(pkgPath: string): Promise<void> {
		try {
			const fs = require('fs/promises');
			await fs.unlink(pkgPath);
		} catch (err) {
			this.logService.warn(`axon-update#deleteCachedPackageFile - failed: ${(err as Error).message}`);
		}
	}

	// allow-any-unicode-next-line
	// ── 同版本增量更新时间戳 ──────────────────────────────────────────────

	private getTimestampFilePath(): string {
		return path.join(this.environmentMainService.userDataPath, LAST_UPDATE_TIMESTAMP_FILE);
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
