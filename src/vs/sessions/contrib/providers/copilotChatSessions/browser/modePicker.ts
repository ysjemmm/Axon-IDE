/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Stub: Copilot mode picker — Axon IDE does not ship Copilot.
 * This file exists so esbuild can resolve the import and not fail the build.
 */

import { Emitter, Event } from '../../../../../base/common/event.js';
import { Disposable } from '../../../../../base/common/lifecycle.js';
import type { IChatMode } from '../../../../../workbench/contrib/chat/common/chatModes.js';

export class ModePicker extends Disposable {
	// Fires IChatMode like the real implementation: agentHostAgentPicker passes it straight to _selectMode(mode: IChatMode).
	private readonly _onDidChange = this._register(new Emitter<IChatMode>());
	readonly onDidChange: Event<IChatMode> = this._onDidChange.event;

	constructor() {
		super();
	}

	render(_container: HTMLElement): void {
		// no-op stub
	}
}
