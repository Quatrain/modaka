import type { APIRoute } from 'astro';
import { QueueManager } from '../../lib/queue';

export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
   try {
      const { url, category, contextNote, crawlDepth } = await request.json();
      if (!url) {
         return new Response(JSON.stringify({ error: 'Aucune URL fournie' }), {
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
