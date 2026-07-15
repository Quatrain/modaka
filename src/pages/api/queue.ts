import type { APIRoute } from 'astro';
import { QueueManager } from '../../lib/queue';

export const GET: APIRoute = async () => {
   try {
      const tasks = QueueManager.getTasks();
      return new Response(JSON.stringify({ success: true, tasks }), {
         status: 200,
         headers: { 'Content-Type': 'application/json' }
      });
   } catch (err: any) {
      return new Response(JSON.stringify({ error: err.message || 'Failed to fetch queue' }), {
         status: 500,
         headers: { 'Content-Type': 'application/json' }
      });
   }
};

export const prerender = false;
