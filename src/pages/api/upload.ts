import type { APIRoute } from 'astro';
import { initBackend } from '../../lib/backend';
import { ContentItem } from '../../lib/models/ContentItem';
import { Storage } from '@quatrain/storage';
import { GeminiAdapter } from '@quatrain/ai-gemini';
import pdf from 'pdf-parse';
import { Readable } from 'node:stream';
import * as crypto from 'node:crypto';
import * as path from 'node:path';

export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
   initBackend();

   try {
      const formData = await request.formData();
      const file = formData.get('file') as File;
      if (!file) {
         return new Response(JSON.stringify({ error: 'No file uploaded' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' }
         });
      }

      // Convert File to Buffer for pdf-parse
      const arrayBuffer = await file.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);

      // Parse PDF
      let pdfData;
      try {
         pdfData = await pdf(buffer);
      } catch (err: any) {
         return new Response(JSON.stringify({ error: `Failed to parse PDF: ${err.message}` }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' }
         });
      }

      const rawText = pdfData.text;

      // Initialize Gemini Adapter
      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey) {
         return new Response(JSON.stringify({ error: 'GEMINI_API_KEY not configured' }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
         });
      }
      const gemini = new GeminiAdapter(apiKey);

      const prompt = `You are a professional documentation assistant. Below is the raw extracted text from a PDF document. Your task is to:
1. Extract a concise, accurate title for the document.
2. Draft a 2-3 sentence summary.
3. Identify 3-5 relevant keyword tags.
4. Clean and format the raw text into clean, beautiful markdown. Preserve all headings, bullet points, code blocks, and structured text while removing raw artifacts, page numbers, or header/footer noise.

Raw PDF Text:
---
${rawText}
---`;

      const schema = {
         type: 'OBJECT',
         properties: {
            title: { type: 'STRING' },
            summary: { type: 'STRING' },
            tags: { 
               type: 'ARRAY', 
               items: { type: 'STRING' } 
            },
            markdown: { type: 'STRING' }
         },
         required: ['title', 'summary', 'tags', 'markdown']
      };

      const result = await gemini.generateStructured(prompt, schema);

      // Save raw PDF and cleaned Markdown to document-storage
      const docStorage = Storage.getStorage('document-storage');
      
      const fileUid = crypto.randomUUID();
      const pdfRef = `pdfs/${fileUid}-${file.name}`;
      const mdRef = `markdowns/${fileUid}-${file.name.replace(/\.pdf$/i, '')}.md`;

      const getDocFile = (ref: string, mime: string) => ({
         bucket: 'documents',
         ref,
         name: path.basename(ref),
         mime
      });

      // Write PDF stream
      await docStorage.create(getDocFile(pdfRef, 'application/pdf') as any, Readable.from([buffer]));

      // Write Markdown stream
      await docStorage.create(getDocFile(mdRef, 'text/markdown') as any, Readable.from([result.markdown]));

      // Create ContentItem metadata record in OKF backend
      const contentItem = await ContentItem.factory({
         title: result.title || file.name,
         category: (formData.get('category') as string) || 'inbox',
         tags: result.tags || [],
         summary: result.summary,
         originalFileUri: pdfRef,
         markdownFileUri: mdRef,
         createdAt: new Date().toISOString()
      });

      await contentItem.save();

      return new Response(JSON.stringify({ 
         success: true, 
         item: contentItem.toJSON() 
      }), {
         status: 200,
         headers: { 'Content-Type': 'application/json' }
      });

   } catch (err: any) {
      return new Response(JSON.stringify({ error: err.message || 'Internal Server Error' }), {
         status: 500,
         headers: { 'Content-Type': 'application/json' }
      });
   }
};
