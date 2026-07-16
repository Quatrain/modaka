import type { APIRoute } from 'astro';
import { QueueManager } from '../../lib/queue';

export const prerender = false;

function isAssetUrl(urlStr: string): boolean {
   try {
      const url = new URL(urlStr);
      const lowerPath = url.pathname.toLowerCase().replace(/\/$/, '');
      return (
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
      );
   } catch {
      return true; // invalid URL
   }
}

export const POST: APIRoute = async ({ request }) => {
   try {
      const { url, category, contextNote, crawlDepth } = await request.json();
      if (!url) {
         return new Response(JSON.stringify({ error: 'Aucune URL fournie' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' }
         });
      }

      if (isAssetUrl(url)) {
         return new Response(JSON.stringify({ error: "L'URL fournie pointe vers une image, une icône ou un fichier statique non-indexable" }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' }
         });
      }

      // Add task to QueueManager for background processing
      const task = await QueueManager.addTask({
         type: 'url',
         name: url,
         url,
         category: category || 'inbox',
         contextNote,
         crawlDepth: typeof crawlDepth === 'number' ? crawlDepth : 0
      });

      return new Response(JSON.stringify({ 
         success: true, 
         queued: true,
         taskId: task.id 
      }), {
         status: 202,
         headers: { 'Content-Type': 'application/json' }
      });

   } catch (err: any) {
      return new Response(JSON.stringify({ error: err.message || 'Internal Server Error' }), {
         status: 500,
         headers: { 'Content-Type': 'application/json' }
      });
   }
};
