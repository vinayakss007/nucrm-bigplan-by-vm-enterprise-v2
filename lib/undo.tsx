/**
 * Undo System — track last N actions per session, offer 10s undo via toast
 */
import toast from 'react-hot-toast';

interface UndoAction {
  id: string;
  type: string;
  label: string;
  entityType: string;
  entityId: string;
  previousState: any;
  timestamp: number;
  undo: () => Promise<void>;
}

const MAX_UNDO = 20;
const UNDO_TIMEOUT = 10000;
const undoStack: UndoAction[] = [];

export function pushUndo(
  label: string,
  entityType: string,
  entityId: string,
  previousState: any,
  undoFn: () => Promise<void>
): void {
  undoStack.push({
    id: `${entityType}-${entityId}-${Date.now()}`,
    type: 'delete',
    label,
    entityType,
    entityId,
    previousState,
    timestamp: Date.now(),
    undo: undoFn,
  });

  if (undoStack.length > MAX_UNDO) {
    undoStack.shift();
  }
}

export function showUndoToast(
  message: string,
  undoFn: () => Promise<void>,
  duration = 10000
): void {
  const toastId = toast(
    (t) => (
      <div className="flex items-center gap-3">
        <span className="text-sm">{message}</span>
        <button
          onClick={async () => {
            toast.dismiss(t.id);
            try {
              await undoFn();
              toast.success('Undone');
            } catch {
              toast.error('Undo failed');
            }
          }}
          className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-violet-600 text-white hover:bg-violet-700 transition-colors shrink-0"
        >
          Undo
        </button>
      </div>
    ),
    { duration }
  );
}

export function clearUndo(entityType?: string, entityId?: string): void {
  if (entityType && entityId) {
    const idx = undoStack.findIndex(
      a => a.entityType === entityType && a.entityId === entityId
    );
    if (idx >= 0) undoStack.splice(idx, 1);
  } else {
    undoStack.length = 0;
  }
}
