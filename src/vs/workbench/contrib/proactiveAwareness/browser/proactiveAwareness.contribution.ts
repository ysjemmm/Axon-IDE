/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { registerWorkbenchContribution2, WorkbenchPhase, getWorkbenchContribution } from '../../../common/contributions.js';
import { ProactiveAwarenessContribution } from './proactiveAwarenessContribution.js';
import { CommandsRegistry, ICommandService } from '../../../../platform/commands/common/commands.js';
import { ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';

// Re-export setting keys for external consumers
export { PROACTIVE_AWARENESS_ENABLED_SETTING, PROACTIVE_AWARENESS_TERMINAL_ERRORS_SETTING, PROACTIVE_AWARENESS_DIAGNOSTICS_SETTING } from './proactiveAwarenessContribution.js';

// --- Command Registration ---

CommandsRegistry.registerCommand('axon.proactiveAwareness.handle', async (accessor: ServicesAccessor) => {
	const commandService = accessor.get(ICommandService);
	const contribution = getWorkbenchContribution<ProactiveAwarenessContribution>(ProactiveAwarenessContribution.ID);

	// Build a summary + details from the collected events
	const events = contribution.getEvents();
	const count = events.length;
	const summary = count === 1
		? '检测到 1 个问题'
		: `检测到 ${count} 个问题`;
	const details = events.map((e, i) => `${i + 1}. ${e.message}`).join('\n');

	// Clear first so the status bar indicator disappears immediately
	contribution.clearEvents();

	// Send the issues into the Axon chat as context (opens & focuses chat too)
	await commandService.executeCommand('axon.addProactiveAwarenessToChat', { summary, details });
});

// --- Contribution Registration ---

registerWorkbenchContribution2(
	ProactiveAwarenessContribution.ID,
	ProactiveAwarenessContribution,
	WorkbenchPhase.AfterRestored
);
