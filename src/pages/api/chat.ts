import type { APIRoute } from 'astro';
import { initBackend } from '../../lib/backend';
import { ContentItem } from '../../lib/models/ContentItem';
import { Storage } from '@quatrain/storage';
import { GeminiAdapter } from '@quatrain/ai-gemini';
import { Readable } from 'node:stream';
import * as path from 'node:path';

export const prerender = false;

async function _streamToString(stream: Readable): Promise<string> {
   const chunks: Buffer[] = [];
   for await (const chunk of stream) {
      chunks.push(Buffer.from(chunk));
   }
   return Buffer.concat(chunks).toString('utf-8');
}

export const POST: APIRoute = async ({ request }) => {
   initBackend();

   try {
      const { messages } = await request.json();
      if (!messages || !Array.isArray(messages)) {
         return new Response(JSON.stringify({ error: 'Invalid message thread' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' }
         });
      }

      // Fetch all metadata documents to construct high-level context
      const query = ContentItem.query();
      const itemsResult = await ContentItem.repository().query(query);
      const items = itemsResult.items || [];

      // Look up and load full content for any referenced documents
      const lastMessage = messages[messages.length - 1]?.content || '';
      let enrichedContent = '';

      for (const item of items) {
         const title = item.val('title') || '';
         const id = item.val('id') || '';
         if (
            lastMessage.includes(id) || 
            (title.length > 3 && lastMessage.toLowerCase().includes(title.toLowerCase()))
         ) {
            const markdownRef = item.val('markdownFileUri');
            if (markdownRef) {
               try {
                  const docStorage = Storage.getStorage('document-storage');
                  const getDocFile = (ref: string) => ({
                     bucket: 'documents',
                     ref,
                     name: path.basename(ref)
                  });
                  const stream = await docStorage.getReadable(getDocFile(markdownRef) as any);
                  const fullText = await _streamToString(stream);
                  enrichedContent += `\n\n[Full Content for Document: ${title} (${id})]\n---\n${fullText}\n---`;
               } catch (e) {
                  // ignore
               }
            }
         }
      }

      const docListContext = items.map((item, idx) => {
         return `[Document #${idx + 1}]
ID: ${item.val('id')}
Title: ${item.val('title')}
Category: ${item.val('category')}
Tags: ${item.val('tags')?.join(', ') || ''}
Summary: ${item.val('summary')}`;
      }).join('\n\n');

      const systemPrompt = `You are Second Brain Copilot, a tactile and touch-friendly personal knowledge assistant.
You help the user manage their uploaded documents, extract notes, draft content, and query information.

Below is the list of documents available in the Second Brain database:
${docListContext}
${enrichedContent}

Instructions:
1. Always keep responses clear, direct, and structured. Use Markdown headings, lists, and bold text to make it readable on a mobile screen.
2. If the user asks about a document that you have the full content for (loaded above), answer their question using that content.
3. If they ask about a document but you don't have the full content, ask them to clarify or mention the title exactly so you can load it in the context window.
4. Keep the tone friendly, helpful, and concise.`;

      // Build messages array for Gemini
      const formattedMessages = messages.map((m: any) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`).join('\n');
      const finalPrompt = `${systemPrompt}\n\nChat History:\n${formattedMessages}\n\nAssistant:`;

      // Initialize Gemini Adapter
      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey) {
         return new Response(JSON.stringify({ error: 'GEMINI_API_KEY not configured' }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
         });
      }
      const gemini = new GeminiAdapter(apiKey);
      const responseText = await gemini.generateText(finalPrompt);

      return new Response(JSON.stringify({ 
         success: true, 
         response: responseText 
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
