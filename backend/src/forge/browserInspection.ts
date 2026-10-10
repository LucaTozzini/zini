import type { Locator } from "playwright";

// Fixed read-only page code: no arbitrary model-authored JavaScript or UI actions.
// As a string because the backend does not include browser DOM types.
const INSPECT = `(elements) => ({
  count: elements.length,
  elements: elements.slice(0, 10).map(element => {
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return {
      tag: element.tagName.toLowerCase(),
      text: (element.textContent || '').trim().slice(0, 500),
      classes: element.getAttribute('class'),
      role: element.getAttribute('role'),
      value: typeof element.value === 'string' ? element.value : undefined,
      checked: typeof element.checked === 'boolean' ? element.checked : undefined,
      disabled: typeof element.disabled === 'boolean' ? element.disabled : undefined,
      visible: rect.width > 0 && rect.height > 0 && style.visibility === 'visible' && style.display !== 'none',
      bounds: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
      style: {
        color: style.color, backgroundColor: style.backgroundColor,
        fontWeight: style.fontWeight, textDecoration: style.textDecorationLine,
        display: style.display, visibility: style.visibility, opacity: style.opacity,
        borderColor: style.borderColor, outlineColor: style.outlineColor
      }
    };
  })
})`;

// evaluateAll serializes a function and supplies its matched nodes. A string is
// instead treated as an expression and doesn't receive those nodes.
const inspectInPage = new Function("elements", `return (${INSPECT})(elements);`) as (elements: unknown[]) => unknown;

export async function inspectElements(locator: Locator) {
  return await locator.evaluateAll(inspectInPage);
}
