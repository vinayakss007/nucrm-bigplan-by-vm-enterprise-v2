# Workflow Builder Undo/Redo + Save Indicator Missing (Issue #479)

During our functional verification, we noted the absence of an undo/redo stack and lack of feedback regarding the save state in the workflow builder component.

## Issue Details
- When navigating to `app/tenant/automation/builder/page.tsx` (the visual drag-drop workflow builder), modifications such as creating, deleting, or moving actions are not reversible.
- Additionally, there is no explicit visual indicator to reassure users that their ongoing changes to a workflow have been saved.

## Recommendation
Implement a generic state history hook (or leverage the existing drawing/node framework, e.g. `xyflow/react` / `@xyflow/react`) to push states to an undo/redo stack. Pair this with a debounced auto-save mechanism that updates a "Saving..." / "Saved" visual indicator in the builder header.
