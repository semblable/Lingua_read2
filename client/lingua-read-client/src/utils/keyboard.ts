/** Native controls and editable regions own their keyboard interactions. */
export function isInteractiveKeyboardTarget(target: EventTarget | null): boolean {
  return target instanceof Element && !!target.closest(
    'input, textarea, select, button, a, summary, [role="button"], [role="link"], [role="textbox"], [contenteditable]:not([contenteditable="false"])'
  );
}
