import type { APIRoute } from 'astro';
import * as crypto from 'node:crypto';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import { QueueManager } from '../../lib/queue';

export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
   try {
      const formData = await request.formData();
      const file = formData.get('file') as File | null;
      const textContent = (formData.get('textContent') as string) || '';
      const contextNote = (formData.get('contextNote') as string) || '';
      const formCategory = (formData.get('category') as string) || 'inbox';

      if (!file && !textContent.trim()) {
         return new Response(JSON.stringify({ error: 'Aucun fichier ni texte fourni' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' }
         });
      }

      let taskId = '';
      if (file) {
         // Save the uploaded file to a temporary location
         const tempDir = path.resolve(process.cwd(), 'tmp');
         await fs.mkdir(tempDir, { recursive: true });

         const arrayBuffer = await file.arrayBuffer();
         const buffer = Buffer.from(arrayBuffer);
         const isImage = file.type.startsWith('image/') || /\.(jpg|jpeg|png|webp|gif)$/i.test(file.name);

         const tempFilePath = path.join(tempDir, `${crypto.randomUUID()}-${file.name}`);
         await fs.writeFile(tempFilePath, buffer);

         // Add document processing task to background queue
         const task = await QueueManager.addTask({
            type: isImage ? 'image' : 'pdf',
            name: file.name,
            tempFilePath,
            category: formCategory,
            contextNote
         });
         taskId = task.id;
      } else {
         // Add text/markdown processing task to background queue
         const task = await QueueManager.addTask({
            type: 'text',
            name: 'Texte collé',
            textContent: textContent.trim(),
            category: formCategory,
            contextNote
         });
         taskId = task.id;
      }

      return new Response(JSON.stringify({ 
         success: true, 
         queued: true,
         taskId
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
