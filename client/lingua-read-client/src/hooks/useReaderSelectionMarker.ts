import { useCallback, useLayoutEffect, useRef, type RefObject } from 'react';

type ScopeAnchor = { id?: string; sentenceIndex?: string; path: number[]; text: string };
type SelectionAnchor = { scope: ScopeAnchor; start: number; end: number };
const selectedClass = 'reader-word-selected';

/** One text pass supplies both the source snapshot and every word's character offsets.
 * In particular, avoid cloning the sentence prefix separately for each token: long
 * subtitle cues and dragged paragraphs should cost only one walk of their content.
 */
const scanScope = (scope: Element) => {
  const words = new Map<HTMLElement, { start: number; end: number }>();
  const chunks: string[] = [];
  let offset = 0;
  const walker = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT, {
    acceptNode: node => node.parentElement?.closest('.bookmark-icon') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT,
  });
  let node: Node | null;
  while ((node = walker.nextNode())) {
    const text = node.nodeValue ?? '';
    const span = node.parentElement?.closest<HTMLElement>('.clickable-word');
    if (span && scope.contains(span)) {
      const previous = words.get(span);
      words.set(span, { start: previous?.start ?? offset, end: offset + text.length });
    }
    chunks.push(text);
    offset += text.length;
  }
  return { text: chunks.join(''), words };
};

const elementPath = (element: Element, root: Element): number[] => {
  const path: number[] = [];
  let current: Element | null = element;
  while (current && current !== root) {
    const parent: Element | null = current.parentElement;
    if (!parent) return [];
    path.unshift(Array.prototype.indexOf.call(parent.children, current));
    current = parent;
  }
  return path;
};

/** Keeps the inspected occurrence visible without changing native selection or keyboard focus.
 * Text offsets belong to one sentence/cue, so status saves may merge word spans and virtual
 * transcript rows may remount without moving the indicator to another occurrence of a word.
 */
export function useReaderSelectionMarker(containerRef: RefObject<HTMLElement | null>, generation: object) {
  const selection = useRef<{ generation: object; anchors: SelectionAnchor[] } | null>(null);
  const marked = useRef(new Set<HTMLElement>());

  const reconcile = useCallback(() => {
    const container = containerRef.current;
    const next = new Set<HTMLElement>();
    if (container && selection.current?.generation === generation) {
      for (const anchor of selection.current.anchors) {
        let scope: Element | null = container;
        if (anchor.scope.id) {
          scope = document.getElementById(anchor.scope.id);
        } else if (anchor.scope.sentenceIndex !== undefined) {
          scope = Array.from(container.querySelectorAll('[data-sentence-index]'))
            .find(node => node.getAttribute('data-sentence-index') === anchor.scope.sentenceIndex) ?? null;
        } else {
          for (const index of anchor.scope.path) scope = scope?.children[index] ?? null;
        }
        if (!scope || !container.contains(scope)) continue;
        const scan = scanScope(scope);
        if (scan.text !== anchor.scope.text) continue;
        for (const [span, offsets] of scan.words) {
          if (offsets.start < anchor.end && offsets.end > anchor.start) next.add(span);
        }
      }
    }
    for (const span of marked.current) if (!next.has(span)) span.classList.remove(selectedClass);
    for (const span of next) if (!span.classList.contains(selectedClass)) span.classList.add(selectedClass);
    marked.current = next;
  }, [containerRef, generation]);

  const markSelection = useCallback((spans: readonly HTMLElement[]) => {
    const container = containerRef.current;
    const anchors: SelectionAnchor[] = [];
    const scopeAnchors = new Map<Element, SelectionAnchor>();
    const scans = new Map<Element, ReturnType<typeof scanScope>>();
    if (container) for (const span of spans) {
      if (!container.contains(span)) continue;
      const scope = span.closest('.srt-line, .sentence, .sentence-mode-text, .reader-title-line') ?? container;
      let scan = scans.get(scope);
      if (!scan) { scan = scanScope(scope); scans.set(scope, scan); }
      const offsets = scan.words.get(span);
      if (!offsets) continue;
      const { start, end } = offsets;
      const previous = scopeAnchors.get(scope);
      if (previous) {
        previous.start = Math.min(previous.start, start);
        previous.end = Math.max(previous.end, end);
        continue;
      }
      const anchor = {
        scope: { id: scope.id || undefined, sentenceIndex: scope.getAttribute('data-sentence-index') ?? undefined,
          path: elementPath(scope, container), text: scan.text },
        start, end,
      };
      anchors.push(anchor);
      scopeAnchors.set(scope, anchor);
    }
    selection.current = { generation, anchors };
    reconcile();
  }, [containerRef, generation, reconcile]);

  // The ref's actual surface can change between standard, sentence and virtual transcript
  // layouts. Reattach after commits, while retaining the captured occurrence until generation changes.
  useLayoutEffect(() => {
    reconcile();
    const container = containerRef.current;
    if (!container) return;
    const observer = new MutationObserver(reconcile);
    observer.observe(container, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  });

  return markSelection;
}
