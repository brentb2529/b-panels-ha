// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { sanitizeHtml } from './sanitizeHtml';

describe('sanitizeHtml (M-2 RSS XSS defence)', () => {
  it('strips <script> elements entirely (content not re-injected as markup)', () => {
    const out = sanitizeHtml('<p>hi</p><script>window.x=1</script>');
    expect(out).toContain('<p>hi</p>');
    expect(out.toLowerCase()).not.toContain('<script');
    expect(out).not.toContain('window.x=1');
  });

  it('removes inline event-handler attributes (onerror/onclick)', () => {
    const out = sanitizeHtml('<img src="https://x/y.png" onerror="steal()">');
    expect(out.toLowerCase()).not.toContain('onerror');
    expect(out).not.toContain('steal()');
    // The safe src survives.
    expect(out).toContain('https://x/y.png');
  });

  it('drops javascript: hrefs but keeps http(s) links', () => {
    const evil = sanitizeHtml('<a href="javascript:alert(1)">x</a>');
    expect(evil.toLowerCase()).not.toContain('javascript:');
    const good = sanitizeHtml('<a href="https://example.com">x</a>');
    expect(good).toContain('https://example.com');
  });

  it('strips obfuscated javascript: with embedded whitespace/control chars', () => {
    const out = sanitizeHtml('<a href="java\tscript:alert(1)">x</a>');
    expect(out.toLowerCase()).not.toContain('script:alert');
  });

  it('removes <iframe>, <object>, <embed>, <style>, <svg>, <form>', () => {
    const out = sanitizeHtml(
      '<iframe src="//evil"></iframe><object></object><embed>' +
        '<style>*{}</style><svg onload="x()"></svg><form action="//evil"></form><p>ok</p>'
    );
    const lo = out.toLowerCase();
    expect(lo).not.toContain('<iframe');
    expect(lo).not.toContain('<object');
    expect(lo).not.toContain('<embed');
    expect(lo).not.toContain('<style');
    expect(lo).not.toContain('<svg');
    expect(lo).not.toContain('<form');
    expect(lo).not.toContain('onload');
    expect(out).toContain('<p>ok</p>');
  });

  it('drops data: URIs (no base64 script smuggling) but keeps text', () => {
    const out = sanitizeHtml('<a href="data:text/html,<script>x</script>">link</a>');
    expect(out.toLowerCase()).not.toContain('data:');
    expect(out).toContain('link');
  });

  it('keeps benign formatting (bold/italic/lists/headings)', () => {
    const out = sanitizeHtml('<h2>T</h2><p><b>bold</b> <i>it</i></p><ul><li>a</li></ul>');
    expect(out).toContain('<h2>T</h2>');
    expect(out).toContain('<b>bold</b>');
    expect(out).toContain('<li>a</li>');
  });

  it('returns empty string for empty/nullish input', () => {
    expect(sanitizeHtml('')).toBe('');
    expect(sanitizeHtml(undefined as unknown as string)).toBe('');
  });
});
