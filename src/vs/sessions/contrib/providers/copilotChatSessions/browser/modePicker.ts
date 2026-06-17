/**
 * Stub: Copilot mode picker — Axon IDE does not ship Copilot.
 * This file exists so esbuild can resolve the import and not fail the build.
 */

import { Emitter, Event } from '../../../../../base/common/event.js';
import { Disposable } from '../../../../../base/common/lifecycle.js';

export class ModePicker extends Disposable {
	private readonly _onDidChange = this._register(new Emitter<string>());
	readonly onDidChange: Event<string> = this._onDidChange.event;

	constructor() {
		super();
	}

	render(_container: HTMLElement): void {
		// no-op stub
	}
}
