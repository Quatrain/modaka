import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import pdf from 'pdf-parse';
import { Readable } from 'node:stream';
import { Log } from '@quatrain/log';
import { Storage } from '@quatrain/storage';
import { Ai } from '@quatrain/ai';
import { Backend } from '@quatrain/backend';
import { ContentItem } from './models/ContentItem';
import { initBackend } from './backend';

export interface Task {
   id: string;
   status: 'pending' | 'processing' | 'completed' | 'failed';
   type: 'pdf' | 'image' | 'url' | 'text';
   name: string;
   progress: number;
   error?: string;
   createdAt: string;
   startedAt?: string;
   completedAt?: string;
   tempFilePath?: string;
   url?: string;
   textContent?: string;
   category: string;
   contextNote?: string;
   crawlDepth?: number;
}

function normalizeUrl(urlStr: string): string {
   try {
      const obj = new URL(urlStr);
      return obj.origin + obj.pathname.replace(/\/$/, '') + obj.search;
   } catch (e) {
      return urlStr;
   }
}

function extractLinks(html: string, baseUrl: string): string[] {
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

class QueueManagerClass {
   private tasks: Map<string, Task> = new Map();
   private isProcessing = false;

   public getTasks(): Task[] {
      return Array.from(this.tasks.values()).sort(
         (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      );
   }

   public getTask(id: string): Task | undefined {
      return this.tasks.get(id);
   }

   public async addTask(task: Omit<Task, 'id' | 'status' | 'progress' | 'createdAt'>): Promise<Task> {
      const newTask: Task = {
         ...task,
         id: crypto.randomUUID(),
         status: 'pending',
         progress: 0,
         createdAt: new Date().toISOString()
      };
      this.tasks.set(newTask.id, newTask);
      this.triggerProcessing();
      return newTask;
   }

   private triggerProcessing() {
      if (this.isProcessing) return;
      this.processNext();
   }

   private async processNext() {
      const pendingTask = Array.from(this.tasks.values()).find(t => t.status === 'pending');
      if (!pendingTask) {
         this.isProcessing = false;
         return;
      }

      this.isProcessing = true;
      pendingTask.status = 'processing';
      pendingTask.progress = 10;
      pendingTask.startedAt = new Date().toISOString();
      Log.info(`[Queue] Processing task ${pendingTask.id} (${pendingTask.name})`);

      try {
         await this.executeTask(pendingTask);
         pendingTask.status = 'completed';
         pendingTask.progress = 100;
         Log.info(`[Queue] Completed task ${pendingTask.id}`);
      } catch (err: any) {
         pendingTask.status = 'failed';
         pendingTask.error = err.message || 'Unknown error';
         Log.error(`[Queue] Failed task ${pendingTask.id}: ${pendingTask.error}`, err);
      } finally {
         pendingTask.completedAt = new Date().toISOString();
         if (pendingTask.tempFilePath) {
            try {
               await fs.unlink(pendingTask.tempFilePath);
            } catch (e) {
               // ignore
            }
         }
         setTimeout(() => this.processNext(), 0);
      }
   }

   private async executeTask(task: Task): Promise<void> {
      initBackend();

      let rawText = '';
      let isImage = false;
      let isText = false;
      let mediaPart: any = null;
      let buffer: Buffer | null = null;

      task.progress = 20;

      const slugify = (text: string) => {
         return text
            .toString()
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .toLowerCase()
            .trim()
            .replace(/\s+/g, '-')
            .replace(/[^\w\-]+/g, '')
            .replace(/\-\-+/g, '-');
      };

      const getDocFile = (ref: string, mime: string) => ({
         bucket: 'documents',
         ref,
         name: path.basename(ref),
         mime
      });

      const schema = {
         type: 'OBJECT',
         properties: {
            title: { type: 'STRING' },
            type: { type: 'STRING' },
            summary: { type: 'STRING' },
            category: { type: 'STRING' },
            tags: { 
               type: 'ARRAY', 
               items: { type: 'STRING' } 
            },
            markdown: { type: 'STRING' }
         },
         required: ['title', 'type', 'summary', 'category', 'tags', 'markdown']
      };

      const gemini = Ai.getAdapter();
      const model = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
      const docStorage = Storage.getStorage('document-storage');

      if (task.type === 'url') {
         if (!task.url) throw new Error('Missing URL for URL ingestion');
         
         const mainUrl = task.url;
         Log.info(`[Queue] Fetching main URL: ${mainUrl}`);
         const response = await fetch(mainUrl, {
            headers: {
               'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            }
         });
         if (!response.ok) {
            throw new Error(`Impossible de récupérer le contenu de l'URL principale (${response.status})`);
         }
         const html = await response.text();
         rawText = html
            .replace(/<script[^>]*>([\s\S]*?)<\/script>/gi, '')
            .replace(/<style[^>]*>([\s\S]*?)<\/style>/gi, '')
            .replace(/<[^>]+>/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();

         // Extract links for Level 1 crawling
         const level1Links = extractLinks(html, mainUrl);
         const processedUrls = new Set<string>([normalizeUrl(mainUrl)]);
         
         task.progress = 25;

         const parentPrompt = `You are a professional documentation assistant. Below is the raw text of a web page. Your task is to:
1. Extract a concise, accurate title for the document.
2. Determine a friendly concept type for the document (e.g. "specification", "guide", "article", "report", "manual", "note"). Use lowercase, singular.
3. Draft a 2-3 sentence summary.
4. Clean and format the raw text into clean, beautiful markdown. Preserve all headings, lists, tables, code blocks, and links while removing navigation menus, headers, footers, sidebars, and advertising blocks.
5. Suggest a hierarchical category folder path (e.g. "technology/programming/javascript", "literature/science-fiction", "finance/investment", "personal/notes", "health/fitness") that best fits the document content. The category path should use lowercase letters, numbers, and slashes for segments (do not include trailing/leading slashes, and do not use "inbox" as the top level unless no other category is appropriate).
6. Identify 3-5 relevant keyword tags.

${task.contextNote ? `Crucial User Context Note / Focus Instructions:\n- ${task.contextNote}\nUse this context to guide the title extraction, type determination, summary creation, tags selection, category suggestions, and clean markdown formatting.\n` : ''}

Raw HTML Text:
---
${rawText}
---`;

         const parentResult = await gemini.generateStructured(parentPrompt, schema, { model });
         
         const finalCategory = (task.category && task.category !== 'inbox' && task.category !== 'all') 
            ? task.category 
            : (parentResult.category || 'inbox');

         const parentSemanticId = slugify(parentResult.title || 'webpage') || crypto.randomUUID();
         const fileUid = crypto.randomUUID();
         const parentMdRef = `markdowns/${fileUid}-${parentSemanticId}.md`;

         // Save initial parent document
         await docStorage.create(getDocFile(parentMdRef, 'text/markdown') as any, Readable.from([parentResult.markdown]));

         const parentItem = await ContentItem.factory({
            id: parentSemanticId,
            title: parentResult.title,
            type: parentResult.type || 'note',
            category: finalCategory,
            tags: parentResult.tags || [],
            summary: parentResult.summary,
            originalFileUri: mainUrl,
            markdownFileUri: parentMdRef,
            contextNote: task.contextNote || '',
            body: parentResult.markdown,
            createdAt: new Date().toISOString()
         });
         await parentItem.save();

         // Begin crawling level 1 & 2 conditionally based on crawlDepth
         const children: Array<{ id: string; title: string; url: string; level: number }> = [];
         const crawlDepth = typeof task.crawlDepth === 'number' ? task.crawlDepth : 0;
         const level2Candidates: string[] = [];

         if (crawlDepth > 0) {
            // Level 1: crawl up to 5 links from the main page
            const linksToCrawlLevel1 = level1Links.slice(0, 5);
            task.progress = 30;
            let progressStep = 40 / (linksToCrawlLevel1.length || 1);

            for (const link1 of linksToCrawlLevel1) {
               const normalized = normalizeUrl(link1);
               if (processedUrls.has(normalized)) continue;
               processedUrls.add(normalized);

               try {
                  Log.info(`[Queue] Ingesting Level 1 Sub-document: ${link1}`);
                  const childResponse = await fetch(link1, {
                     headers: {
                        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
                     }
                  });
                  if (!childResponse.ok) continue;

                  const childHtml = await childResponse.text();
                  const childRawText = childHtml
                     .replace(/<script[^>]*>([\s\S]*?)<\/script>/gi, '')
                     .replace(/<style[^>]*>([\s\S]*?)<\/style>/gi, '')
                     .replace(/<[^>]+>/g, ' ')
                     .replace(/\s+/g, ' ')
                     .trim();

                  const childPrompt = `You are a professional documentation assistant. Below is the raw text of a sub-page from a website. This sub-page is part of a larger parent document: "${parentResult.title}".
Your task is to:
1. Extract a concise, accurate title for this sub-page.
2. Determine a friendly concept type for this sub-page (e.g. "specification", "guide", "article", "section", "note"). Use lowercase, singular.
3. Draft a 2-3 sentence summary.
4. Clean and format the raw text into clean, beautiful markdown. Preserve all headings, lists, tables, code blocks, and links.
5. Identify 3-5 relevant keyword tags.

Raw Input Text:
---
${childRawText}
---`;

                  const childResult = await gemini.generateStructured(childPrompt, schema, { model });
                  const childSemanticId = slugify(childResult.title || 'subpage') || crypto.randomUUID();
                  const childFileUid = crypto.randomUUID();
                  const childMdRef = `markdowns/${childFileUid}-${childSemanticId}.md`;

                  // Write sub-page markdown
                  await docStorage.create(getDocFile(childMdRef, 'text/markdown') as any, Readable.from([childResult.markdown]));

                  const childItem = await ContentItem.factory({
                     id: childSemanticId,
                     title: childResult.title,
                     type: childResult.type || 'note',
                     category: finalCategory, // Keep exact same category
                     tags: childResult.tags || [],
                     summary: childResult.summary,
                     parent: parentSemanticId, // Link to parent
                     originalFileUri: link1,
                     markdownFileUri: childMdRef,
                     body: childResult.markdown,
                     createdAt: new Date().toISOString()
                  });
                  await childItem.save();

                  children.push({ id: childSemanticId, title: childResult.title, url: link1, level: 1 });

                  // Gather level 2 links from this page
                  const subLinks = extractLinks(childHtml, link1);
                  for (const l2 of subLinks) {
                     const normalizedL2 = normalizeUrl(l2);
                     if (!processedUrls.has(normalizedL2) && !level2Candidates.includes(l2)) {
                        level2Candidates.push(l2);
                     }
                  }
               } catch (err) {
                  Log.warn(`[Queue] Failed to crawl Level 1 link ${link1}: ${err}`);
               }

               task.progress = Math.min(70, task.progress + progressStep);
            }
         }

         if (crawlDepth > 1) {
            // Level 2: crawl up to 5 links from the Level 2 candidate pool
            const linksToCrawlLevel2 = level2Candidates.slice(0, 5);
            task.progress = 70;
            let progressStep = 20 / (linksToCrawlLevel2.length || 1);

            for (const link2 of linksToCrawlLevel2) {
               const normalized = normalizeUrl(link2);
               if (processedUrls.has(normalized)) continue;
               processedUrls.add(normalized);

               try {
                  Log.info(`[Queue] Ingesting Level 2 Sub-document: ${link2}`);
                  const childResponse = await fetch(link2, {
                     headers: {
                        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
                     }
                  });
                  if (!childResponse.ok) continue;

                  const childHtml = await childResponse.text();
                  const childRawText = childHtml
                     .replace(/<script[^>]*>([\s\S]*?)<\/script>/gi, '')
                     .replace(/<style[^>]*>([\s\S]*?)<\/style>/gi, '')
                     .replace(/<[^>]+>/g, ' ')
                     .replace(/\s+/g, ' ')
                     .trim();

                  const childPrompt = `You are a professional documentation assistant. Below is the raw text of a sub-page from a website. This sub-page is part of a larger parent document: "${parentResult.title}".
Your task is to:
1. Extract a concise, accurate title for this sub-page.
2. Determine a friendly concept type for this sub-page (e.g. "specification", "guide", "article", "section", "note"). Use lowercase, singular.
3. Draft a 2-3 sentence summary.
4. Clean and format the raw text into clean, beautiful markdown. Preserve all headings, lists, tables, code blocks, and links.
5. Identify 3-5 relevant keyword tags.

Raw Input Text:
---
${childRawText}
---`;

                  const childResult = await gemini.generateStructured(childPrompt, schema, { model });
                  const childSemanticId = slugify(childResult.title || 'subpage') || crypto.randomUUID();
                  const childFileUid = crypto.randomUUID();
                  const childMdRef = `markdowns/${childFileUid}-${childSemanticId}.md`;

                  await docStorage.create(getDocFile(childMdRef, 'text/markdown') as any, Readable.from([childResult.markdown]));

                  const childItem = await ContentItem.factory({
                     id: childSemanticId,
                     title: childResult.title,
                     type: childResult.type || 'note',
                     category: finalCategory,
                     tags: childResult.tags || [],
                     summary: childResult.summary,
                     parent: parentSemanticId, // Link to parent
                     originalFileUri: link2,
                     markdownFileUri: childMdRef,
                     body: childResult.markdown,
                     createdAt: new Date().toISOString()
                  });
                  await childItem.save();

                  children.push({ id: childSemanticId, title: childResult.title, url: link2, level: 2 });
               } catch (err) {
                  Log.warn(`[Queue] Failed to crawl Level 2 link ${link2}: ${err}`);
               }

               task.progress = Math.min(90, task.progress + progressStep);
            }
         }

         // Update parent document's markdown to add sub-documents list
         if (children.length > 0) {
            Log.info(`[Queue] Appending ${children.length} sub-document links to parent ${parentSemanticId}`);
            const childLinksSection = '\n\n## Documents enfants associés\n\n' + 
               children
                  .map(c => `* [${c.title}](${c.id}.md) - Niveau ${c.level} (Source : [lien](${c.url}))`)
                  .join('\n');

            const updatedBody = parentResult.markdown + childLinksSection;
            
            // Rewrite updated markdown file
            await docStorage.create(getDocFile(parentMdRef, 'text/markdown') as any, Readable.from([updatedBody]));

            // Update parent record
            parentItem.set('body', updatedBody);
            await parentItem.save();
         }

         task.progress = 100;
         return;
      }

      if (task.type === 'text') {
         isText = true;
         rawText = task.textContent || '';
      } else if (task.tempFilePath) {
         buffer = await fs.readFile(task.tempFilePath);
         isImage = task.type === 'image';

         if (isImage) {
            const base64Data = buffer.toString('base64');
            const ext = path.extname(task.tempFilePath).toLowerCase();
            const mimeType = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg';
            mediaPart = {
               inlineData: {
                  mimeType,
                  data: base64Data
               }
            };
         } else {
            try {
               const pdfData = await pdf(buffer);
               rawText = pdfData.text;
            } catch (err: any) {
               throw new Error(`Erreur d'analyse PDF : ${err.message}`);
            }
         }
      }

      task.progress = 40;

      let result;

      if (isImage) {
         const imagePrompt = `You are a professional documentation assistant. Below is uploaded image. Your task is to:
1. Extract title.
2. concept type.
3. 2-3 sentence summary.
4. transcribe/describe in markdown.
5. suggest category folder path.
6. tags.

${task.contextNote ? `Crucial User Context Note:\n- ${task.contextNote}\n` : ''}`;

         result = await gemini.generateStructured([
            { text: imagePrompt },
            mediaPart
         ], schema, { model });
      } else {
         const textPrompt = `You are a professional documentation assistant. Below is text. Your task is to:
1. Extract title.
2. type.
3. summary.
4. markdown formatting.
5. category path.
6. tags.

${task.contextNote ? `Crucial User Context Note:\n- ${task.contextNote}\n` : ''}

Raw Text:
---
${rawText}
---`;

         result = await gemini.generateStructured(textPrompt, schema, { model });
      }

      task.progress = 70;

      const fileUid = crypto.randomUUID();
      const originalName = task.name.replace(/\.[^/.]+$/, '');
      const mdRef = `markdowns/${fileUid}-${slugify(originalName)}.md`;

      if (task.tempFilePath && buffer) {
         const rawRef = isImage ? `images/${fileUid}-${task.name}` : `pdfs/${fileUid}-${task.name}`;
         await docStorage.create(getDocFile(rawRef, isImage ? 'image/jpeg' : 'application/pdf') as any, Readable.from([buffer]));
      }

      await docStorage.create(getDocFile(mdRef, 'text/markdown') as any, Readable.from([result.markdown]));

      const finalCategory = (task.category && task.category !== 'inbox' && task.category !== 'all') 
         ? task.category 
         : (result.category || 'inbox');

      const semanticId = slugify(result.title || originalName) || crypto.randomUUID();

      task.progress = 85;

      const contentItem = await ContentItem.factory({
         id: semanticId,
         title: result.title || task.name,
         type: result.type || 'note',
         category: finalCategory,
         tags: result.tags || [],
         summary: result.summary,
         originalFileUri: task.tempFilePath ? (isImage ? `images/${fileUid}-${task.name}` : `pdfs/${fileUid}-${task.name}`) : undefined,
         markdownFileUri: mdRef,
         contextNote: task.contextNote || '',
         body: result.markdown,
         createdAt: new Date().toISOString()
      });

      await contentItem.save();
   }
}

const GLOBAL_QUEUE_KEY = Symbol.for('__second_brain_queue');
if (!(globalThis as any)[GLOBAL_QUEUE_KEY]) {
   (globalThis as any)[GLOBAL_QUEUE_KEY] = new QueueManagerClass();
}

export const QueueManager = (globalThis as any)[GLOBAL_QUEUE_KEY] as QueueManagerClass;
