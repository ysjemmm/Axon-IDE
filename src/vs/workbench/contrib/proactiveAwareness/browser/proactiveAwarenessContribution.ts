/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { MarkdownString } from '../../../../base/common/htmlContent.js';
import { IWorkbenchContribution } from '../../../common/contributions.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { ITerminalInstance, ITerminalService } from '../../terminal/browser/terminal.js';
import { IMarkerService } from '../../../../platform/markers/common/markers.js';
import { IStatusbarService, IStatusbarEntryAccessor, IStatusbarEntry, StatusbarAlignment } from '../../../services/statusbar/browser/statusbar.js';
import { ITerminalCommand, TerminalCapability } from '../../../../platform/terminal/common/capabilities/capabilities.js';
import { CommandsRegistry } from '../../../../platform/commands/common/commands.js';

// --- Setting Keys (registered via extensions/axon-ide/package.json) ---
export const PROACTIVE_AWARENESS_ENABLED_SETTING = 'axon.proactiveAwareness.enabled';
export const PROACTIVE_AWARENESS_TERMINAL_ERRORS_SETTING = 'axon.proactiveAwareness.terminalErrors';
export const PROACTIVE_AWARENESS_DIAGNOSTICS_SETTING = 'axon.proactiveAwareness.diagnostics';

/**
 * Represents a detected awareness event from user operations.
 */
export interface IAwarenessEvent {
	readonly type: 'terminalError' | 'diagnosticChange';
	readonly message: string;
	readonly timestamp: number;
}

/**
 * Tracks which terminal instances are AI-operated (hideFromUser) so we only
 * react to user-initiated terminal commands and diagnostic changes.
 *
 * The contribution listens to:
 * 1. Terminal command completions with non-zero exit codes (user terminals only)
 * 2. Marker (diagnostics) changes that increase error/warning counts
 *
 * When an awareness event fires, a badge is shown on the global activity area
 * to notify the user that something went wrong and the AI could potentially help.
 */
export class ProactiveAwarenessContribution extends Disposable implements IWorkbenchContribution {

	static readonly ID = 'workbench.contrib.proactiveAwareness';

	private _statusbarEntry: IStatusbarEntryAccessor | undefined;
	private readonly _events: IAwarenessEvent[] = [];

	/** Baseline diagnostic counts — used to detect increases after user edits. */
	private _baselineErrors = 0;
	private _baselineWarnings = 0;

	/**
	 * Track terminal instance IDs that are AI-operated (hideFromUser).
	 */
	private readonly _aiTerminalIds = new Set<number>();

	/**
	 * Command-level AI tracking: time windows of AI-initiated command executions.
	 * When a command finishes, we check if its timestamp falls within any AI
	 * execution window. Entries are cleaned up after 5 minutes.
	 */
	private readonly _aiCommandWindows: { startTime: number; endTime?: number }[] = [];

	constructor(
		@IConfigurationService private readonly _configurationService: IConfigurationService,
		@ILogService private readonly _logService: ILogService,
		@ITerminalService private readonly _terminalService: ITerminalService,
		@IMarkerService private readonly _markerService: IMarkerService,
		@IStatusbarService private readonly _statusbarService: IStatusbarService,
	) {
		super();

		this._initBaselineDiagnostics();
		this._registerTerminalListeners();
		this._registerDiagnosticListeners();
		this._registerConfigurationListeners();
		this._registerAiCommandMarking();
	}

	// --- AI Command Marking ---

	/**
	 * Register commands that the Axon extension calls to mark AI-initiated
	 * terminal commands. This enables command-level (not terminal-level) filtering.
	 */
	private _registerAiCommandMarking(): void {
		// Extension calls this before executing a command in a terminal
		this._register(CommandsRegistry.registerCommand('axon.internal.markAiCommandStart', (_accessor, startTime: number) => {
			this._aiCommandWindows.push({ startTime });
			// Cleanup old entries (>5 min)
			const cutoff = Date.now() - 5 * 60 * 1000;
			while (this._aiCommandWindows.length > 0 && this._aiCommandWindows[0].startTime < cutoff) {
				this._aiCommandWindows.shift();
			}
		}));

		// Extension calls this after command finishes
		this._register(CommandsRegistry.registerCommand('axon.internal.markAiCommandEnd', (_accessor, startTime: number) => {
			// Find the window matching this startTime and mark it as ended
			for (let i = this._aiCommandWindows.length - 1; i >= 0; i--) {
				if (this._aiCommandWindows[i].startTime === startTime && !this._aiCommandWindows[i].endTime) {
					this._aiCommandWindows[i].endTime = Date.now();
					break;
				}
			}
		}));
	}

	/**
	 * Check if a command finishing at the given timestamp was AI-initiated
	 * (falls within any AI execution window).
	 */
	private _isAiCommand(commandTimestamp: number): boolean {
		for (const w of this._aiCommandWindows) {
			const end = w.endTime ?? Date.now();
			// Command started during AI execution window (± 2s tolerance)
			if (commandTimestamp >= w.startTime - 2000 && commandTimestamp <= end + 2000) {
				return true;
			}
		}
		return false;
	}

	// --- Initialization ---

	private _initBaselineDiagnostics(): void {
		const stats = this._markerService.getStatistics();
		this._baselineErrors = stats.errors;
		this._baselineWarnings = stats.warnings;
	}

	// --- Terminal Error Detection ---

	private _registerTerminalListeners(): void {
		for (const instance of this._terminalService.instances) {
			this._subscribeToTerminalCommands(instance);
		}

		this._register(this._terminalService.onDidCreateInstance(instance => {
			this._subscribeToTerminalCommands(instance);
		}));
	}

	private _subscribeToTerminalCommands(instance: ITerminalInstance): void {
		// Skip hidden tool terminals (VS Code internal, completely invisible)
		if (instance.shellLaunchConfig.hideFromUser) {
			this._aiTerminalIds.add(instance.instanceId);
			return;
		}

		// Subscribe to command detection capability when it becomes available
		const cmdDetection = instance.capabilities.get(TerminalCapability.CommandDetection);
		if (cmdDetection) {
			this._register(cmdDetection.onCommandFinished(command => {
				this._handleTerminalCommandFinished(instance.instanceId, command);
			}));
		}

		this._register(instance.capabilities.onDidAddCommandDetectionCapability(capability => {
			this._register(capability.onCommandFinished(command => {
				this._handleTerminalCommandFinished(instance.instanceId, command);
			}));
		}));
	}

	private _handleTerminalCommandFinished(
		instanceId: number,
		command: ITerminalCommand
	): void {
		if (!this._isEnabled() || !this._isTerminalErrorsEnabled()) {
			return;
		}

		// Skip hidden tool terminals
		if (this._aiTerminalIds.has(instanceId)) {
			return;
		}

		// Command-level check: skip if this command was AI-initiated
		if (this._isAiCommand(command.timestamp)) {
			return;
		}

		// Only react to non-zero exit codes (command failures)
		if (command.exitCode === undefined || command.exitCode === 0) {
			return;
		}

		const cmdText = command.command || '<unknown>';
		const message = `Terminal command failed (exit code ${command.exitCode}): ${cmdText}`;

		this._logService.info(`[ProactiveAwareness] ${message}`);
		this._addEvent({
			type: 'terminalError',
			message,
			timestamp: Date.now(),
		});
	}

	// --- Diagnostics Change Detection ---

	private _registerDiagnosticListeners(): void {
		this._register(this._markerService.onMarkerChanged(() => {
			this._handleDiagnosticsChanged();
		}));
	}

	private _handleDiagnosticsChanged(): void {
		if (!this._isEnabled() || !this._isDiagnosticsEnabled()) {
			return;
		}

		const stats = this._markerService.getStatistics();
		const newErrors = stats.errors - this._baselineErrors;
		const newWarnings = stats.warnings - this._baselineWarnings;

		// Only fire if errors or warnings have *increased*
		if (newErrors <= 0 && newWarnings <= 0) {
			// Update baseline downward when issues are resolved
			this._baselineErrors = stats.errors;
			this._baselineWarnings = stats.warnings;
			return;
		}

		const parts: string[] = [];
		if (newErrors > 0) {
			parts.push(`${newErrors} new error${newErrors > 1 ? 's' : ''}`);
		}
		if (newWarnings > 0) {
			parts.push(`${newWarnings} new warning${newWarnings > 1 ? 's' : ''}`);
		}
		const message = `Diagnostics increased: ${parts.join(', ')}`;

		this._logService.info(`[ProactiveAwareness] ${message}`);
		this._addEvent({
			type: 'diagnosticChange',
			message,
			timestamp: Date.now(),
		});

		// Update baseline to current level so we don't re-fire for the same issues
		this._baselineErrors = stats.errors;
		this._baselineWarnings = stats.warnings;
	}

	// --- Configuration ---

	private _registerConfigurationListeners(): void {
		this._register(this._configurationService.onDidChangeConfiguration(e => {
			if (e.affectsConfiguration(PROACTIVE_AWARENESS_ENABLED_SETTING)) {
				if (!this._isEnabled()) {
					this._clearBadge();
					this._events.length = 0;
				}
			}
		}));
	}

	private _isEnabled(): boolean {
		return this._configurationService.getValue<boolean>(PROACTIVE_AWARENESS_ENABLED_SETTING) ?? true;
	}

	private _isTerminalErrorsEnabled(): boolean {
		return this._configurationService.getValue<boolean>(PROACTIVE_AWARENESS_TERMINAL_ERRORS_SETTING) ?? true;
	}

	private _isDiagnosticsEnabled(): boolean {
		return this._configurationService.getValue<boolean>(PROACTIVE_AWARENESS_DIAGNOSTICS_SETTING) ?? true;
	}

	// --- Badge Management ---

	private _addEvent(event: IAwarenessEvent): void {
		this._events.push(event);
		this._updateBadge();
	}

	private _updateBadge(): void {
		const count = this._events.length;
		if (count === 0) {
			this._clearBadge();
			return;
		}

		const hasErrors = this._events.some(e => e.type === 'terminalError' ||
			(e.type === 'diagnosticChange' && e.message.includes('error')));

		const terminalErrors = this._events.filter(e => e.type === 'terminalError').length;
		const diagChanges = this._events.filter(e => e.type === 'diagnosticChange').length;

		let text: string;
		if (terminalErrors > 0 && diagChanges > 0) {
			text = `$(sparkle) 发现 ${terminalErrors} 个终端报错、${diagChanges} 个新诊断`;
		} else if (terminalErrors > 0) {
			text = `$(sparkle) 发现 ${terminalErrors} 个终端报错`;
		} else {
			text = `$(sparkle) 发现 ${diagChanges} 个新诊断`;
		}

		const tooltip = this._buildTooltip(hasErrors);
		const command = 'axon.proactiveAwareness.handle';
		const ariaLabel = '检测到来自你操作的问题，点击让 AI 协助处理';

		const entry: IStatusbarEntry = {
			name: 'Axon 主动感知',
			text,
			ariaLabel,
			tooltip,
			kind: 'prominent',
			command,
		};

		if (this._statusbarEntry) {
			this._statusbarEntry.update(entry);
		} else {
			this._statusbarEntry = this._statusbarService.addEntry(
				entry,
				'status.proactiveAwareness',
				StatusbarAlignment.LEFT,
				49 /* just after Problems indicator (priority 50) */
			);
		}
	}

	/**
	 * Builds a rich markdown tooltip listing the detected issues with a
	 * call-to-action footer. Markdown tooltips render with the themed hover
	 * widget styling instead of the plain black text tooltip.
	 */
	private _buildTooltip(hasErrors: boolean): MarkdownString {
		const md = new MarkdownString('', { supportThemeIcons: true });
		md.isTrusted = true;

		const headerIcon = hasErrors ? '$(error)' : '$(warning)';
		md.appendMarkdown(`${headerIcon} **Axon 主动感知**\n\n`);
		md.appendMarkdown(`检测到以下来自你操作的问题：\n\n`);

		const maxShown = 5;
		this._events.slice(0, maxShown).forEach((e, i) => {
			const itemIcon = e.type === 'terminalError' ? '$(terminal)' : '$(warning)';
			md.appendMarkdown(`${itemIcon} ${i + 1}. ${e.message}\n\n`);
		});
		if (this._events.length > maxShown) {
			md.appendMarkdown(`… 还有 ${this._events.length - maxShown} 个\n\n`);
		}

		md.appendMarkdown(`---\n\n`);
		md.appendMarkdown(`$(sparkle) 点击将这些问题发送给 Axon 协助处理`);
		return md;
	}

	private _clearBadge(): void {
		if (this._statusbarEntry) {
			this._statusbarEntry.dispose();
			this._statusbarEntry = undefined;
		}
	}

	/**
	 * Clears all tracked events and removes the badge.
	 */
	clearEvents(): void {
		this._events.length = 0;
		this._clearBadge();
		this._logService.info('[ProactiveAwareness] Events cleared');
	}

	/**
	 * Returns the current list of unacknowledged awareness events.
	 */
	getEvents(): readonly IAwarenessEvent[] {
		return this._events;
	}
}
