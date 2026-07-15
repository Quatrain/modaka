import type { APIRoute } from 'astro';
import { initBackend } from '../../lib/backend';
import { ContentItem } from '../../lib/models/ContentItem';
import { Storage } from '@quatrain/storage';
import { Ai } from '@quatrain/ai';
import { Backend } from '@quatrain/backend';
import { Core } from '@quatrain/core';
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
         Core.warn('[Chat API] Request failed: Invalid message thread');
         return new Response(JSON.stringify({ error: 'Invalid message thread' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' }
         });
      }

      // Fetch all metadata documents to construct high-level context
      const query = ContentItem.query();
      const itemsResult = await ContentItem.repository().query(query);
      const items = itemsResult.items || [];
      Backend.info(`Queried metadata documents from database: found ${items.length} items`);

      // Look up and load full content for any referenced documents
      const lastMessage = messages[messages.length - 1]?.content || '';
      let enrichedContent = '';

      for (const item of items) {
         const title = item.val('title') || '';
         const id = item.uid || '';
         
         const cleanMsg = lastMessage.toLowerCase();
         const hasIdMatch = cleanMsg.includes(id.toLowerCase());
         
         // Extract words from title, filtering out common stop words
         const stopWords = new Set(['les', 'des', 'une', 'pour', 'avec', 'dans', 'the', 'and', 'for', 'sur', 'aux', 'mon', 'mes', 'ton', 'tes', 'son', 'ses', 'une', 'par', 'grace', 'dune']);
         const titleWords = title.toLowerCase()
            .replace(/[^\w\s-]/g, ' ')
            .split(/\s+/)
            .filter(w => w.length > 2 && !stopWords.has(w));
            
         const hasTitleMatch = titleWords.some(word => cleanMsg.includes(word));
         
         const hasTagMatch = item.val('tags')?.some(tag => 
            tag.length > 2 && !stopWords.has(tag.toLowerCase()) && cleanMsg.includes(tag.toLowerCase())
         );

         if (hasIdMatch || hasTitleMatch || hasTagMatch) {
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
ID: ${item.uid}
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

      // Retrieve Gemini Adapter via global AI registry
      let gemini;
      try {
         gemini = Ai.getAdapter();
      } catch (err: any) {
         Core.error('[Chat API] AI Adapter not initialized: ' + err.message, err);
         return new Response(JSON.stringify({ error: 'AI Adapter not initialized: ' + err.message }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
         });
      }
      const model = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
      Core.info(`[Gemini] Sending prompt to model: ${model}`);
      Core.debug(`[Gemini] Conversation Prompt: ${finalPrompt}`);
      const responseText = await gemini.generateText(finalPrompt, { model });
      Core.info('[Gemini] Received text response successfully');

      return new Response(JSON.stringify({ 
         success: true, 
         response: responseText 
      }), {
         status: 200,
         headers: { 'Content-Type': 'application/json' }
      });

   } catch (err: any) {
      Core.error('[Chat API] Execution failed: ' + err.message, err);
      return new Response(JSON.stringify({ error: err.message || 'Internal Server Error' }), {
         status: 500,
         headers: { 'Content-Type': 'application/json' }
      });
   }
};
