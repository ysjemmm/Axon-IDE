/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Splits markdown into top-level blocks at paragraph boundaries — runs of
 * one or more blank lines (`\n\n`) that are NOT inside a fenced code block.
 *
 * Each returned string includes its trailing blank-line separator, so
 * concatenating all returned blocks reproduces the input exactly. The
 * boundary detection mirrors `lastBlockBoundary` in {@link ParagraphBuffer}
 * so split points align with the streaming render boundaries.
 *
 * Why this matters: chat markdown streams append-only. Once a `\n\n`
 * boundary closes a block, that block's source text never changes again.
 * Rendering each block into its own DOM node lets callers reuse the DOM of
 * unchanged blocks across re-renders, preserving internal state such as a
 * table's horizontal scroll position. Only the final, still-growing block
 * (e.g. a table that has not yet been followed by a blank line) is
 * re-rendered as new tokens arrive.
 *
 * Known limitation: blocks are rendered independently, so markdown
 * constructs that span block boundaries (e.g. reference-style link
 * definitions placed in a separate paragraph from their usage) will not
 * resolve. This is an accepted trade-off shared by block-level streaming
 * markdown renderers and does not occur in typical chat output.
 */
export function splitMarkdownBlocks(text: string): string[] {
	const blocks: string[] = [];
	let inFence = false;
	let blockStart = 0;

	for (let i = 0; i < text.length; i++) {
		// Toggle fenced code block state on ``` or ~~~ at the start of a line.
		if ((i === 0 || text[i - 1] === '\n') &&
			((text[i] === '`' && text[i + 1] === '`' && text[i + 2] === '`') ||
				(text[i] === '~' && text[i + 1] === '~' && text[i + 2] === '~'))) {
			inFence = !inFence;
			i += 2; // skip past the triple backtick/tilde
			continue;
		}

		// A paragraph boundary outside code fences ends the current block.
		if (!inFence && text[i] === '\n' && text[i + 1] === '\n') {
			// Consume the full run of consecutive newlines so the separator
			// stays attached to the block that precedes it.
			let end = i + 1;
			while (text[end] === '\n') {
				end++;
			}
			blocks.push(text.slice(blockStart, end));
			blockStart = end;
			i = end - 1;
		}
	}

	if (blockStart < text.length) {
		blocks.push(text.slice(blockStart));
	}

	return blocks;
}
