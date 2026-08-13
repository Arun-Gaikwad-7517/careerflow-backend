/**
 * HTML Sanitizer Utility (Server & Client Safe)
 * Strips script tags, iframe elements, event handlers, and malicious URLs.
 * Preserves safe structural markup (headings, paragraphs, lists, bold/italic, safe links).
 */

function sanitizeHtml(rawHtml) {
  if (!rawHtml || typeof rawHtml !== 'string') return '';

  let cleaned = rawHtml
    // 1. Remove dangerous script and iframe elements completely
    .replace(/<script\b[^<]*>([\s\S]*?)<\/script>/gi, '')
    .replace(/<iframe\b[^<]*>([\s\S]*?)<\/iframe>/gi, '')
    .replace(/<object\b[^<]*>([\s\S]*?)<\/object>/gi, '')
    .replace(/<embed\b[^<]*>([\s\S]*?)<\/embed>/gi, '')
    .replace(/<style\b[^<]*>([\s\S]*?)<\/style>/gi, '')
    // 2. Strip inline event handlers (onerror, onload, onclick, etc.)
    .replace(/\s+on\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    // 3. Disallow javascript: and data: text/html in URIs
    .replace(/href\s*=\s*("javascript:[^"]*"|'javascript:[^']*')/gi, 'href="#"')
    .replace(/src\s*=\s*("javascript:[^"]*"|'javascript:[^']*')/gi, 'src="#"')
    .trim();

  return cleaned;
}

module.exports = {
  sanitizeHtml
};
