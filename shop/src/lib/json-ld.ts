/**
 * JSON for a `<script type="application/ld+json">` block. JSON.stringify leaves `<`, `>` and `&` as they are, so a
 * product name containing «</script>» would end the block early and the rest would be parsed as HTML. These and the
 * JavaScript line separators U+2028 / U+2029 are written as \uXXXX escapes: the JSON means exactly the same, and the
 * text can no longer close the script element.
 */
const UNSAFE = new RegExp(`[<>&${String.fromCharCode(0x2028, 0x2029)}]`, 'g');

export function jsonLd(data: unknown): string {
  return JSON.stringify(data).replace(UNSAFE, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);
}
