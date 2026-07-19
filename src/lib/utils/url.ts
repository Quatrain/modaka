/**
 * Normalizes a URL by stripping trailing slashes and ensuring unified structure.
 */
export function normalizeUrl(urlStr: string): string {
   try {
      const obj = new URL(urlStr);
      return obj.origin + obj.pathname.replace(/\/$/, '') + obj.search;
   } catch (e) {
      return urlStr;
   }
}

/**
 * Extracts and filters same-origin links from an HTML body (ignoring assets/binaries).
 */
export function extractLinks(html: string, baseUrl: string): string[] {
   const links: string[] = [];
   let baseObj: URL;
   try {
      baseObj = new URL(baseUrl);
   } catch (e) {
      return [];
   }
   
   const hrefRegex = /href=["']([^"']+)["']/gi;
   let match;
   while ((match = hrefRegex.exec(html)) !== null) {
      const href = match[1];
      if (!href || href.startsWith('#') || href.startsWith('javascript:')) continue;
      try {
         const resolved = new URL(href, baseUrl);
         if (
            (resolved.protocol === 'http:' || resolved.protocol === 'https:') &&
            resolved.hostname === baseObj.hostname &&
            resolved.pathname !== baseObj.pathname
         ) {
             const lowerPath = resolved.pathname.toLowerCase().replace(/\/$/, '');
             if (
                lowerPath.endsWith('.css') ||
                lowerPath.endsWith('.js') ||
                lowerPath.endsWith('.png') ||
                lowerPath.endsWith('.jpg') ||
                lowerPath.endsWith('.jpeg') ||
                lowerPath.endsWith('.gif') ||
                lowerPath.endsWith('.svg') ||
                lowerPath.endsWith('.ico') ||
                lowerPath.endsWith('.woff') ||
                lowerPath.endsWith('.woff2') ||
                lowerPath.endsWith('.ttf') ||
                lowerPath.endsWith('.mp4') ||
                lowerPath.endsWith('.mp3') ||
                lowerPath.endsWith('.zip') ||
                lowerPath.endsWith('.pdf') ||
                lowerPath.endsWith('.json') ||
                lowerPath.endsWith('.xml') ||
                lowerPath.includes('favicon')
             ) {
                continue;
             }

            const cleanUrl = resolved.origin + resolved.pathname.replace(/\/$/, '') + resolved.search;
            if (!links.includes(cleanUrl)) {
               links.push(cleanUrl);
            }
         }
      } catch (e) {
         // ignore
      }
   }
   return links;
}
