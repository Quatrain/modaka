import { describe, it, expect } from 'vitest';
import { normalizeUrl, extractLinks } from './url';

describe('url utilities', () => {
   describe('normalizeUrl', () => {
      it('should strip trailing slash', () => {
         expect(normalizeUrl('https://example.com/')).toBe('https://example.com');
         expect(normalizeUrl('https://example.com/page/')).toBe('https://example.com/page');
      });

      it('should preserve query parameters', () => {
         expect(normalizeUrl('https://example.com/page/?foo=bar')).toBe('https://example.com/page?foo=bar');
      });

      it('should return original string if invalid URL', () => {
         expect(normalizeUrl('not-a-url')).toBe('not-a-url');
      });
   });

   describe('extractLinks', () => {
      it('should extract same-origin links from HTML', () => {
         const html = `
            <div>
               <a href="/page1">Page 1</a>
               <a href="https://example.com/page2">Page 2</a>
               <a href="https://other.com/page3">External Page</a>
            </div>
         `;
         const links = extractLinks(html, 'https://example.com');
         expect(links).toContain('https://example.com/page1');
         expect(links).toContain('https://example.com/page2');
         expect(links).not.toContain('https://other.com/page3');
      });

      it('should filter out asset types (css, js, media)', () => {
         const html = `
            <div>
               <a href="/style.css">CSS</a>
               <a href="/script.js">JS</a>
               <a href="/image.png">Image</a>
               <a href="/document.pdf">PDF</a>
               <a href="/page1">HTML Page</a>
            </div>
         `;
         const links = extractLinks(html, 'https://example.com');
         expect(links).toContain('https://example.com/page1');
         expect(links).not.toContain('https://example.com/style.css');
         expect(links).not.toContain('https://example.com/script.js');
         expect(links).not.toContain('https://example.com/image.png');
         expect(links).not.toContain('https://example.com/document.pdf');
      });
   });
});
