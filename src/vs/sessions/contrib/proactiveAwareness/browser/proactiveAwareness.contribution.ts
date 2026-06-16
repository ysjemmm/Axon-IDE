/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { registerWorkbenchContribution2, WorkbenchPhase } from '../../../../workbench/common/contributions.js';
import { ProactiveAwarenessContribution } from './proactiveAwarenessContribution.js';

// --- Setting Keys (registered via extensions/axon-ide/package.json) ---

export const PROACTIVE_AWARENESS_ENABLED_SETTING = 'axon.proactiveAwareness.enabled';
export const PROACTIVE_AWARENESS_TERMINAL_ERRORS_SETTING = 'axon.proactiveAwareness.terminalErrors';
export const PROACTIVE_AWARENESS_DIAGNOSTICS_SETTING = 'axon.proactiveAwareness.diagnostics';

// --- Contribution Registration ---

registerWorkbenchContribution2(
	ProactiveAwarenessContribution.ID,
	ProactiveAwarenessContribution,
	WorkbenchPhase.AfterRestored
);
