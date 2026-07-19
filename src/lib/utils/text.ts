/**
 * Convert a string to a safe, URL-friendly slug.
 *
 * @param text - The raw text string to convert.
 * @returns The converted URL-safe slug string.
 */
export function slugify(text: string): string {
   return text
      .toString()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .trim()
      .replace(/\s+/g, '-')
      .replace(/[^\w\-]+/g, '')
      .replace(/\-\-+/g, '-');
}
