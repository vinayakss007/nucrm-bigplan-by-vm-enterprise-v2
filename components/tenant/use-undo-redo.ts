/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
'use client';

import { useState, useCallback, useRef } from 'react';
import type { Node, Edge } from '@xyflow/react';

interface HistoryState {
  nodes: Node[];
  edges: Edge[];
}

interface UseUndoRedoOptions {
  maxHistory?: number;
}

export function useUndoRedo(
  initialNodes: Node[],
  initialEdges: Edge[],
  options: UseUndoRedoOptions = {}
) {
  const { maxHistory = 50 } = options;

  const [history, setHistory] = useState<HistoryState[]>([
    { nodes: initialNodes, edges: initialEdges },
  ]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const lastPushRef = useRef(Date.now());

  const canUndo = currentIndex > 0;
  const canRedo = currentIndex < history.length - 1;

  const pushState = useCallback((nodes: Node[], edges: Edge[]) => {
    // Debounce: don't push if last push was < 100ms ago
    const now = Date.now();
    if (now - lastPushRef.current < 100) return;
    lastPushRef.current = now;

    setHistory(prev => {
      // Remove any future states after current index
      const newHistory = prev.slice(0, currentIndex + 1);
      // Add new state
      newHistory.push({
        nodes: structuredClone(nodes),
        edges: structuredClone(edges),
      });
      // Trim to max history
      if (newHistory.length > maxHistory) {
        newHistory.shift();
      }
      return newHistory;
    });
    setCurrentIndex(prev => Math.min(prev + 1, maxHistory - 1));
  }, [currentIndex, maxHistory]);

  const undo = useCallback((): HistoryState | null => {
    if (!canUndo) return null;
    const newIndex = currentIndex - 1;
    setCurrentIndex(newIndex);
    return history[newIndex] || null;
  }, [canUndo, currentIndex, history]);

  const redo = useCallback((): HistoryState | null => {
    if (!canRedo) return null;
    const newIndex = currentIndex + 1;
    setCurrentIndex(newIndex);
    return history[newIndex] || null;
  }, [canRedo, currentIndex, history]);

  const reset = useCallback((nodes: Node[], edges: Edge[]) => {
    setHistory([{ nodes: structuredClone(nodes), edges: structuredClone(edges) }]);
    setCurrentIndex(0);
  }, []);

  return {
    canUndo,
    canRedo,
    pushState,
    undo,
    redo,
    reset,
    historyLength: history.length,
    currentStep: currentIndex,
  };
}
