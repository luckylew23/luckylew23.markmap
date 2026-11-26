# Whole-Note Mind Map

Draws the whole note as a mind map: every heading and list item in the note becomes a branch, and the full picture opens in a tab (or the sidebar) — no code blocks to write.

- Open it from the command palette, the editor's context menu ("Open Mind Map"), or the mind-map icon beside the outline in the sidebar. The full picture opens in a tab (or in the sidebar, from the sidebar icon); the note's changes repaint the map as you type.
- When the note has exactly one top-level heading, that heading is the root; otherwise the root is the note's file name (without the path). Headings and lists are its branches.
- Only headings get a box; list items and tasks — ordered, unordered, task lines — are drawn with a thin line under the label instead, so the headings stand out and the rest stays quiet. The root keeps its box in either case.
- A label longer than a per-role width budget is wrapped into several lines inside a taller box, so one long node doesn't stretch the whole map sideways: the root is kept on one line, branch labels wrap sooner to keep the skeleton narrow, and leaf list items stay on one line until they are fairly long.
- "Levels" next to the zoom controls draws the map that many levels deep, up to 10: 2 layers in the sidebar, 3 in the tab that shows the whole map. Picking a level redraws the whole map at that depth, so a branch you had folded by hand opens again — the level, not that click, decides what shows. A node whose children the limit hides keeps its small circle, drawn as a plus; clicking it reveals one more level.
- A node with children has a small circle at the right end, where the child lines converge: a horizontal bar means unfolded, plus a vertical one means folded. Click it to fold or unfold the children.
- The map's top-right corner zooms: − shrinks, + grows, and the percentage in the middle is relative to the map's own size, so 100% draws the labels at their normal size in the sidebar and in the tab alike. A map wider than the sidebar scrolls sideways instead of shrinking its text.
- The mouse wheel zooms too, anchored at the pointer, continuously rather than in steps. On a touch screen, a two-finger pinch zooms around the fingers' midpoint, and two fingers moved together pan the map; one finger still scrolls as before.
- Hold the left or right mouse button and drag — on a node or on empty space — and the map follows. Releasing after a drag never folds a node or jumps by mistake.
- "Export image" saves the map as it stands (folded nodes stay folded, the little circles drawn) as an SVG file next to the note, at its full size. A same-named file isn't overwritten: the app picks an unused name. A folder must be open; when the note isn't in one, the image is saved at the top level.
- Click a leaf node to jump to its line in the note; click it in the tab and Textus switches back to that note.
