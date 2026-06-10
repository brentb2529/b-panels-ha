// Tiny dependency-free HTML sanitizer for untrusted feed/markup (M-2).
//
// The RSS proxy (custom_components/b_panels/__init__.py) is SSRF-guarded but
// returns the RAW feed body, which the News tile parses and injects via
// dangerouslySetInnerHTML. A hostile/compromised feed could otherwise ship
// stored XSS that runs in the panel origin (same-origin with HA) and exfiltrate
// the kiosk LLAT from localStorage. We strip every script vector before render.
//
// Allow-list approach: parse the markup, walk the tree, drop disallowed
// elements (script/style/iframe/object/embed/etc.), drop ALL event-handler
// (on*) attributes and any attribute whose value is a javascript:/data: URI,
// and keep only a safe set of attributes on a safe set of elements. Anything
// not understood is dropped.

// Block-disallowed elements: removed entirely (including their subtree) so their
// text content cannot leak back in as live markup.
const DROP_WITH_CONTENT = new Set([
  'SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'EMBED', 'NOSCRIPT', 'TEMPLATE',
  'LINK', 'META', 'BASE', 'FRAME', 'FRAMESET', 'SVG', 'MATH', 'FORM',
  'INPUT', 'BUTTON', 'TEXTAREA', 'SELECT', 'AUDIO', 'VIDEO', 'SOURCE',
]);

// Elements we allow to remain (others are unwrapped: children kept, tag dropped).
const ALLOWED_TAGS = new Set([
  'A', 'P', 'BR', 'B', 'STRONG', 'I', 'EM', 'U', 'SPAN', 'DIV', 'UL', 'OL',
  'LI', 'BLOCKQUOTE', 'CODE', 'PRE', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6',
  'IMG', 'FIGURE', 'FIGCAPTION', 'HR', 'TABLE', 'THEAD', 'TBODY', 'TR',
  'TD', 'TH', 'SMALL', 'SUB', 'SUP', 'CAPTION',
]);

// Per-tag allowed attributes (everything else, incl. all on* handlers, dropped).
const ALLOWED_ATTRS: Record<string, Set<string>> = {
  A: new Set(['href', 'title']),
  IMG: new Set(['src', 'alt', 'title']),
};

const SAFE_URL_RE = /^(https?:|mailto:|tel:|\/|#|\.)/i;

function attrIsSafe(tag: string, name: string, value: string): boolean {
  const lname = name.toLowerCase();
  // Never allow event handlers or style (style can carry url()/expression()).
  if (lname.startsWith('on') || lname === 'style') return false;
  const allowed = ALLOWED_ATTRS[tag];
  if (!allowed || !allowed.has(lname)) return false;
  // URL-bearing attributes must be a safe scheme (kills javascript:, data:).
  if (lname === 'href' || lname === 'src') {
    // Strip whitespace + control chars (e.g. "java\tscript:") before the
    // scheme check so an obfuscated javascript:/data: URI cannot slip past.
    const v = value.replace(/[\u0000-\u0020]+/g, '').toLowerCase();
    if (!SAFE_URL_RE.test(v)) return false;
  }
  return true;
}

function cleanElement(el: Element, doc: Document): void {
  // Snapshot children first (we mutate as we go).
  const children = Array.from(el.childNodes);
  for (const node of children) {
    if (node.nodeType === Node.ELEMENT_NODE) {
      const child = node as Element;
      const tag = child.tagName.toUpperCase();
      if (DROP_WITH_CONTENT.has(tag)) {
        child.remove();
        continue;
      }
      // Recurse first so nested content is cleaned regardless of wrapper fate.
      cleanElement(child, doc);
      if (!ALLOWED_TAGS.has(tag)) {
        // Unwrap: replace the element with its (already-cleaned) children.
        const parent = child.parentNode;
        if (parent) {
          while (child.firstChild) parent.insertBefore(child.firstChild, child);
          parent.removeChild(child);
        }
        continue;
      }
      // Scrub attributes on a kept element.
      for (const attr of Array.from(child.attributes)) {
        if (!attrIsSafe(tag, attr.name, attr.value)) {
          child.removeAttribute(attr.name);
        }
      }
    } else if (
      node.nodeType === Node.COMMENT_NODE ||
      node.nodeType === Node.PROCESSING_INSTRUCTION_NODE
    ) {
      node.parentNode?.removeChild(node);
    }
    // TEXT nodes are kept verbatim (DOM text, not parsed as markup).
  }
}

/**
 * Sanitize an untrusted HTML fragment to a safe subset. Strips script vectors
 * (script/style/iframe/object/embed/svg/etc.), all event-handler attributes,
 * and javascript:/data: URLs. Returns a string safe(r) for
 * dangerouslySetInnerHTML. Falls back to text-only escaping if DOM parsing is
 * unavailable (non-browser env).
 */
export function sanitizeHtml(dirty: string): string {
  if (!dirty) return '';
  if (typeof DOMParser === 'undefined' || typeof document === 'undefined') {
    // No DOM (e.g. SSR/test without jsdom): degrade to escaped text.
    return dirty
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }
  const doc = new DOMParser().parseFromString(`<div>${dirty}</div>`, 'text/html');
  const root = doc.body.firstElementChild;
  if (!root) return '';
  cleanElement(root, doc);
  return root.innerHTML;
}
