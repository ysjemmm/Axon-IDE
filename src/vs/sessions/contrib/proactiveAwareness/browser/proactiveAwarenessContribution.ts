/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable, IDisposable, MutableDisposable } from '../../../../base/common/lifecycle.js';
import { IWorkbenchContribution } from '../../../../workbench/common/contributions.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { ITerminalInstance, ITerminalService } from '../../../../workbench/contrib/terminal/browser/terminal.js';
import { IMarkerService } from '../../../../platform/markers/common/markers.js';
import { IActivityService, WarningBadge, ErrorBadge } from '../../../../workbench/services/activity/common/activity.js';
import { ITerminalCommand, TerminalCapability } from '../../../../platform/terminal/common/capabilities/capabilities.js';
import { SessionsViewId } from '../../sessions/browser/views/sessionsView.js';
import {
	PROACTIVE_AWARENESS_ENABLED_SETTING,
	PROACTIVE_AWARENESS_TERMINAL_ERRORS_SETTING,
	PROACTIVE_AWARENESS_DIAGNOSTICS_SETTING,
} from './proactiveAwareness.contribution.js';

/**
 * Represents a detected awareness event from user operations.
 */
interface IAwarenessEvent {
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
 * When an awareness event fires, a badge is shown on the Sessions sidebar view
 * to notify the user that something went wrong and the AI could potentially help.
 */
export class ProactiveAwarenessContribution extends Disposable implements IWorkbenchContribution {

	static readonly ID = 'workbench.contrib.proactiveAwareness';

	private readonly _badgeDisposable = this._register(new MutableDisposable<IDisposable>());
	private readonly _events: IAwarenessEvent[] = [];

	/** Baseline diagnostic counts — used to detect increases after user edits. */
	private _baselineErrors = 0;
	private _baselineWarnings = 0;

	/**
	 * Track terminal instance IDs that are currently running an AI-initiated
	 * command. Commands from these terminals should be ignored.
	 */
	private readonly _aiTerminalIds = new Set<number>();

	constructor(
		@IConfigurationService private readonly _configurationService: IConfigurationService,
		@ILogService private readonly _logService: ILogService,
		@ITerminalService private readonly _terminalService: ITerminalService,
		@IMarkerService private readonly _markerService: IMarkerService,
		@IActivityService private readonly _activityService: IActivityService,
	) {
		super();

		this._initBaselineDiagnostics();
		this._registerTerminalListeners();
		this._registerDiagnosticListeners();
		this._registerConfigurationListeners();
	}

	// --- Initialization ---

	private _initBaselineDiagnostics(): void {
		const stats = this._markerService.getStatistics();
		this._baselineErrors = stats.errors;
		this._baselineWarnings = stats.warnings;
	}

	// --- Terminal Error Detection ---

	private _registerTerminalListeners(): void {
		// Watch for new terminal instances to subscribe to their command detection
		for (const instance of this._terminalService.instances) {
			this._subscribeToTerminalCommands(instance);
		}

		this._register(this._terminalService.onDidCreateInstance(instance => {
			this._subscribeToTerminalCommands(instance);
		}));
	}

	private _subscribeToTerminalCommands(instance: ITerminalInstance): void {
		// Skip AI-operated terminals (hideFromUser = true means it's an AI tool terminal)
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

		// Double-check: skip if this terminal is AI-operated
		if (this._aiTerminalIds.has(instanceId)) {
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

		const badge = hasErrors
			? { badge: new ErrorBadge(() => this._getBadgeDescription()) }
			: { badge: new WarningBadge(() => this._getBadgeDescription()) };

		this._badgeDisposable.value = this._activityService.showViewActivity(SessionsViewId, badge);
	}

	private _getBadgeDescription(): string {
		const count = this._events.length;
		if (count === 1) {
			return this._events[0].message;
		}
		return `${count} issues detected from user operations`;
	}

	private _clearBadge(): void {
		this._badgeDisposable.clear();
	}

	/**
	 * Clears all tracked events and removes the badge.
	 * Called when the user acknowledges or the AI has addressed the issues.
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
