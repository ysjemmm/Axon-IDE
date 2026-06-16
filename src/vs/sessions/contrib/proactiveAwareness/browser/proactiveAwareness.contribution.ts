/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from '../../../../nls.js';
import { Registry } from '../../../../platform/registry/common/platform.js';
import { ConfigurationScope, Extensions as ConfigurationExtensions, IConfigurationRegistry } from '../../../../platform/configuration/common/configurationRegistry.js';
import { registerWorkbenchContribution2, WorkbenchPhase } from '../../../../workbench/common/contributions.js';
import { ProactiveAwarenessContribution } from './proactiveAwarenessContribution.js';

// --- Configuration Registration ---

export const PROACTIVE_AWARENESS_ENABLED_SETTING = 'sessions.proactiveAwareness.enabled';
export const PROACTIVE_AWARENESS_TERMINAL_ERRORS_SETTING = 'sessions.proactiveAwareness.terminalErrors';
export const PROACTIVE_AWARENESS_DIAGNOSTICS_SETTING = 'sessions.proactiveAwareness.diagnostics';

Registry.as<IConfigurationRegistry>(ConfigurationExtensions.Configuration).registerConfiguration({
	id: 'sessions',
	properties: {
		[PROACTIVE_AWARENESS_ENABLED_SETTING]: {
			type: 'boolean',
			default: true,
			scope: ConfigurationScope.RESOURCE,
			description: localize('proactiveAwareness.enabled', "Controls whether the AI proactive awareness feature is enabled. When enabled, terminal errors and diagnostic changes from user operations will trigger a badge notification on the sidebar."),
		},
		[PROACTIVE_AWARENESS_TERMINAL_ERRORS_SETTING]: {
			type: 'boolean',
			default: true,
			scope: ConfigurationScope.RESOURCE,
			description: localize('proactiveAwareness.terminalErrors', "Controls whether terminal command failures from user operations are detected and shown as proactive awareness notifications."),
		},
		[PROACTIVE_AWARENESS_DIAGNOSTICS_SETTING]: {
			type: 'boolean',
			default: true,
			scope: ConfigurationScope.RESOURCE,
			description: localize('proactiveAwareness.diagnostics', "Controls whether diagnostic (errors/warnings) changes from user operations are detected and shown as proactive awareness notifications."),
		},
	},
});

// --- Contribution Registration ---

registerWorkbenchContribution2(
	ProactiveAwarenessContribution.ID,
	ProactiveAwarenessContribution,
	WorkbenchPhase.AfterRestored
);
