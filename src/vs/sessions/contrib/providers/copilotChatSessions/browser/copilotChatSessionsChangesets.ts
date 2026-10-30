/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Stub: Copilot chat sessions changesets — Axon IDE does not ship Copilot.
 */

import { observableValue } from '../../../../../base/common/observable.js';
import type { IInstantiationService } from '../../../../../platform/instantiation/common/instantiation.js';

/**
 * Stub that always returns an empty changeset observable.
 * Real implementation resolves file changes from session chat history
 * and bundles them into ISessionChangeset items for the UI.
 */
export function createChangesets(
	// All three callers pass the session type string (e.g. SessionType.Local, ISessionType.id).
	_sessionType: string,
	_workspace: unknown,
	_chats: unknown,
	_instantiationService: IInstantiationService,
) {
	return observableValue<readonly []>('empty-changesets', []);
}
