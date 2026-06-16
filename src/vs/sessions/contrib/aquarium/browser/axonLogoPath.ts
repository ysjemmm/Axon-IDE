/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Axon "spark" silhouette — a single 6-pointed neuron/spark glyph in a 0..96
// coordinate space. The aquarium renders this path as live, same-document SVG
// geometry: fish.ts stores it in a shared <symbol>, then renders clipped <use>
// slices with staggered CSS animations. A single subpath with no self-overlap
// keeps the swimming-strip effect, currentColor species tinting, and
// auxiliary-window support intact while reading clearly as the Axon mark.
export const AXON_LOGO_PATH = 'M88 48 L60.99 55.5 L68 82.64 L48 63 L28 82.64 L35.01 55.5 L8 48 L35.01 40.5 L28 13.36 L48 33 L68 13.36 L60.99 40.5 Z';
