import { useState, useEffect, useRef, useCallback, RefObject } from 'react';
import { useLibraryStore } from '../utils/store';
import type { SelectableType, SelectedItem } from '../utils/store';

type Rect = {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
  x: number;
  y: number;
};

function rectsIntersect(a: Rect, b: DOMRect | Rect): boolean {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}

export type UseDragSelectArgs = {
  containerRef: RefObject<HTMLElement | null>;
  enabled?: boolean;
};

export type UseDragSelectResult = {
  selectionRect: Rect | null;
  isDragSelecting: boolean;
};

export function useDragSelect({
  containerRef,
  enabled = true
}: UseDragSelectArgs): UseDragSelectResult {
  const [selectionRect, setSelectionRect] = useState<Rect | null>(null);
  const [isDragSelecting, setIsDragSelecting] = useState(false);

  const startPointRef = useRef<{ x: number; y: number } | null>(null);
  const isSelectingRef = useRef(false);
  const preExistingSelectionRef = useRef<SelectedItem[]>([]);
  const rafIdRef = useRef<number | null>(null);
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;

  const setSelectedItems = useLibraryStore((s) => s.setSelectedItems);
  const clearSelection = useLibraryStore((s) => s.clearSelection);

  const computeSelection = useCallback(
    (rect: Rect) => {
      const container = containerRef.current;
      if (!container) return;

      const elements = container.querySelectorAll<HTMLElement>('[data-selectable-id]');
      const selected: SelectedItem[] = [];

      elements.forEach((el) => {
        const elRect = el.getBoundingClientRect();
        if (rectsIntersect(rect, elRect)) {
          const idRaw = el.dataset.selectableId;
          const type = el.dataset.selectableType as SelectableType | undefined;
          const id = idRaw ? parseInt(idRaw, 10) : NaN;
          if (id && type) {
            selected.push({ id, type });
          }
        }
      });

      // Merge with pre-existing selection (Ctrl+drag)
      const pre = preExistingSelectionRef.current;
      if (pre.length > 0) {
        const merged: SelectedItem[] = [...pre];
        selected.forEach((item) => {
          if (!merged.find((m) => m.id === item.id && m.type === item.type)) {
            merged.push(item);
          }
        });
        setSelectedItems(merged);
      } else {
        setSelectedItems(selected);
      }
    },
    [containerRef, setSelectedItems]
  );

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleMouseDown = (e: MouseEvent) => {
      if (!enabledRef.current) return;
      if (e.button !== 0) return;

      // Only start on empty space
      const target = e.target as HTMLElement | null;
      if (
        target?.closest(
          '.card, button, a, .form-check, .dropdown, .alert, .breadcrumb, input, select'
        )
      ) {
        return;
      }

      e.preventDefault();

      startPointRef.current = { x: e.clientX, y: e.clientY };
      isSelectingRef.current = false;

      if (e.ctrlKey || e.metaKey) {
        preExistingSelectionRef.current = useLibraryStore.getState().selectedItems;
      } else {
        preExistingSelectionRef.current = [];
        clearSelection();
      }

      const handleMouseMove = (e: MouseEvent) => {
        const start = startPointRef.current;
        if (!start) return;

        const dx = e.clientX - start.x;
        const dy = e.clientY - start.y;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (!isSelectingRef.current && dist < 5) return;

        if (!isSelectingRef.current) {
          isSelectingRef.current = true;
          setIsDragSelecting(true);
          container.classList.add('is-drag-selecting');
        }

        const rect: Rect = {
          left: Math.min(start.x, e.clientX),
          top: Math.min(start.y, e.clientY),
          right: Math.max(start.x, e.clientX),
          bottom: Math.max(start.y, e.clientY),
          width: Math.abs(dx),
          height: Math.abs(dy),
          x: Math.min(start.x, e.clientX),
          y: Math.min(start.y, e.clientY)
        };

        setSelectionRect(rect);

        if (rafIdRef.current) cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = requestAnimationFrame(() => {
          computeSelection(rect);
        });
      };

      const handleMouseUp = () => {
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);

        if (rafIdRef.current) {
          cancelAnimationFrame(rafIdRef.current);
          rafIdRef.current = null;
        }

        startPointRef.current = null;
        isSelectingRef.current = false;
        preExistingSelectionRef.current = [];
        setSelectionRect(null);
        setIsDragSelecting(false);
        container.classList.remove('is-drag-selecting');
      };

      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
    };

    container.addEventListener('mousedown', handleMouseDown);
    return () => {
      container.removeEventListener('mousedown', handleMouseDown);
      container.classList.remove('is-drag-selecting');
      if (rafIdRef.current) {
        cancelAnimationFrame(rafIdRef.current);
      }
    };
  }, [containerRef, computeSelection, clearSelection]);

  return { selectionRect, isDragSelecting };
}
