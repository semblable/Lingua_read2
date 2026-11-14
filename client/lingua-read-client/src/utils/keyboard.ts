/** Native controls and editable regions own their keyboard interactions. */
export function isInteractiveKeyboardTarget(target: EventTarget | null): boolean {
  const element = target instanceof Element ? target : target instanceof Node ? target.parentElement : null;
  return !!element?.closest(
    'input, textarea, select, button, a, summary, audio[controls], video[controls], [inert], ' +
    '[role="button"], [role="link"], [role="textbox"], [role="combobox"], [role="spinbutton"], ' +
    '[role="slider"], [role="checkbox"], [role="radio"], [role="switch"], [role="tab"], ' +
    '[role="listbox"], [role="option"], [role="menuitem"], [role="treeitem"], ' +
    '[contenteditable]:not([contenteditable="false"])'
  );
}

export function hasModalKeyboardOwner(): boolean {
  return [...document.querySelectorAll('dialog[open], [role="dialog"][aria-modal="true"], [role="alertdialog"][aria-modal="true"]')]
    .some(element => !element.closest('[hidden], [aria-hidden="true"]'));
}
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';


/** Keep native Tab order inside a modal, including when the browser would
 * otherwise move from its last control into browser chrome. */
export function containModalTabKey(event: ReactKeyboardEvent<HTMLElement>): void {
  if (event.key !== 'Tab' || event.defaultPrevented || event.nativeEvent.isComposing) return;
  const controls = [...event.currentTarget.querySelectorAll<HTMLElement>(
    'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
  )].filter(element => !element.matches(':disabled') && element.tabIndex >= 0 &&
    !element.closest('[hidden], [inert], [aria-hidden="true"]') && element.getClientRects().length > 0);
  const first = controls[0];
  const last = controls[controls.length - 1];
  if (!first) { event.preventDefault(); return; }
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault(); last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault(); first.focus();
  }
}
