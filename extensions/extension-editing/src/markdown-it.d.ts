/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Ambient type declarations for dependencies whose @types may not be
// installed in all build environments (e.g. CI with hoisted dependencies).
declare module 'markdown-it' {
	namespace MarkdownIt {
		interface Token {
			type: string;
			tag: string;
			attrs: [string, string][] | null;
			map: [number, number] | null;
			nesting: number;
			level: number;
			children: Token[] | null;
			content: string;
			markup: string;
			info: string;
			meta: any;
			block: boolean;
			hidden: boolean;
			attrGet(name: string): string | null;
			attrIndex(name: string): number;
			attrJoin(name: string, value: string): void;
			attrPush(attrData: [string, string]): void;
			attrSet(name: string, value: string): void;
		}
	}
	class MarkdownIt {
		constructor(preset?: string, options?: any);
		parse(src: string, env?: any): MarkdownIt.Token[];
		render(src: string, env?: any): string;
	}
	export default MarkdownIt;
}
