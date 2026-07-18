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
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { fetchHtmlWithJs } from './browser';

const execPromise = promisify(exec);

async function gitAddIfRepo(filePath: string) {
   const dir = path.dirname(filePath);
   try {
      const { stdout } = await execPromise('git rev-parse --is-inside-work-tree', { cwd: dir });
      if (stdout.trim() === 'true') {
         await execPromise(`git add "${path.basename(filePath)}"`, { cwd: dir });
         Log.info(`[Git] Added file to index: ${filePath}`);
      }
   } catch (e) {
      // not a git repo or git not found, ignore silently
   }
}

export interface Task {
   id: string;
   status: 'pending' | 'processing' | 'completed' | 'failed';
   type: 'pdf' | 'image' | 'url' | 'text' | 'audio';
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
   recordedLive?: boolean;
   hasTempFile?: boolean;
   latitude?: number;
   longitude?: number;
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

class QueueManagerClass {
   private tasks: Map<string, Task> = new Map();
   private isProcessing = false;

   public async getTasks(): Promise<Task[]> {
      const taskList = Array.from(this.tasks.values());
      const tasksWithExistence = await Promise.all(taskList.map(async task => {
         let hasTempFile = false;
         if (task.tempFilePath) {
            try {
               await fs.access(task.tempFilePath);
               hasTempFile = true;
            } catch {
               hasTempFile = false;
            }
         }
         return { ...task, hasTempFile };
      }));
      return tasksWithExistence.sort(
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

   public async retryTask(id: string): Promise<boolean> {
      const task = this.tasks.get(id);
      if (!task || task.status !== 'failed') return false;

      if (task.tempFilePath) {
         try {
            await fs.access(task.tempFilePath);
         } catch {
            throw new Error("Le fichier temporaire d'origine a été supprimé ou est expiré. Veuillez réenregistrer.");
         }
      }

      task.status = 'pending';
      task.progress = 0;
      delete task.error;
      this.triggerProcessing();
      return true;
   }

   public deleteTask(id: string): boolean {
      const task = this.tasks.get(id);
      if (!task) return false;
      if (task.status === 'processing') return false;

      if (task.tempFilePath) {
         fs.unlink(task.tempFilePath).catch(() => {});
      }
      this.tasks.delete(id);
      return true;
   }

   private async cleanupOldTempFiles() {
      try {
         const tempDir = path.resolve(process.cwd(), 'tmp');
         const files = await fs.readdir(tempDir);
         const now = Date.now();
         const ONE_DAY = 24 * 60 * 60 * 1000;
         
         for (const file of files) {
            if (file === 'chrome-profile') continue;
            const filePath = path.join(tempDir, file);
            const stat = await fs.stat(filePath);
            if (stat.isFile() && (now - stat.mtimeMs > ONE_DAY)) {
               await fs.unlink(filePath);
               Log.info(`[Queue Cleanup] Deleted old temporary file: ${filePath}`);
            }
         }
      } catch (e: any) {
         Log.warn(`[Queue Cleanup] Failed to clean old temp files: ${e.message}`);
      }
   }

   private triggerProcessing() {
      if (this.isProcessing) return;
      this.cleanupOldTempFiles(); // clean async
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
         if (pendingTask.status === 'completed' && pendingTask.tempFilePath) {
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

      const gitLocalPath = process.env.GIT_LOCAL_PATH || path.resolve(process.cwd(), '.second-brain-git');
      const documentStoragePath = process.env.DOCUMENT_STORAGE_PATH || path.resolve(process.cwd(), '.second-brain-docs');

      // Resolve Location Context via Reverse Geocoding if coordinates are provided
      let locationContext = '';
      if (task.latitude !== undefined && task.longitude !== undefined) {
         try {
            Log.info(`[Queue Geocoding] Fetching location for coords: ${task.latitude}, ${task.longitude}`);
            const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${task.latitude}&lon=${task.longitude}&zoom=10`;
            const response = await fetch(url, {
               headers: {
                  'User-Agent': 'SecondBrainNoteTaker/1.0 (contact: brad@quatrain.com)'
               }
            });
            if (response.ok) {
               const data = await response.json();
               if (data && data.address) {
                  const city = data.address.city || data.address.town || data.address.village || data.address.municipality || data.address.county || '';
                  const country = data.address.country || '';
                  locationContext = [city, country].filter(Boolean).join(', ');
                  Log.info(`[Queue Geocoding] Resolved location to: ${locationContext}`);
               }
            }
         } catch (e: any) {
            Log.warn(`[Queue Geocoding] Failed to reverse geocode: ${e.message}`);
         }
      }

      let rawText = '';
      let isImage = false;
      let isText = false;
      let isScannedPdf = false;
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
         bucket: process.env.S3_BUCKET || 'documents',
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
            properNouns: {
               type: 'ARRAY',
               items: { type: 'STRING' }
            },
            markdown: { type: 'STRING' },
            deductedDate: { type: 'STRING' }
         },
         required: ['title', 'type', 'summary', 'category', 'tags', 'properNouns', 'markdown']
      };

      const gemini = Ai.getAdapter();
      const model = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
      const docStorage = Storage.getStorage('document-storage');

      if (task.type === 'url') {
         if (!task.url) throw new Error('Missing URL for URL ingestion');
         
         const mainUrl = task.url;
         Log.info(`[Queue] Fetching main URL: ${mainUrl}`);
         const html = await fetchHtmlWithJs(mainUrl);
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
2. Determine a friendly concept type for the document (e.g. "website", "specification", "guide", "article", "report", "manual", "note"). Use lowercase, singular. Since this is the main entry point page of a website, you MUST use the value "website" as the type.
3. Draft a 2-3 sentence summary.
4. Clean and format the raw text into clean, beautiful markdown. Preserve all headings, lists, tables, code blocks, and links while removing navigation menus, headers, footers, sidebars, and advertising blocks.
5. Suggest a hierarchical category folder path containing at most 2 levels/segments (e.g. "technology/programming", "literature/fiction", "finance/investment", "personal/notes", "health/fitness") that best fits the document content. The category path should use lowercase letters, numbers, and slashes for segments (do not include trailing/leading slashes, and do not use "inbox" as the top level unless no other category is appropriate).
6. Identify 3-5 relevant keyword tags.

${task.contextNote ? `Crucial User Context Note / Focus Instructions:\n- ${task.contextNote}\nUse this context to guide the title extraction, type determination, summary creation, tags selection, category suggestions, and clean markdown formatting.\n` : ''}

Raw HTML Text:
---
${rawText}
---`;

         const parentResult = await gemini.generateStructured(parentPrompt, schema, { model });
         
         let finalCategory = (task.category && task.category !== 'inbox' && task.category !== 'all') 
            ? task.category 
            : (parentResult.category || 'inbox');

         // Limit category depth to at most 2 levels (parent/child)
         const catSegments = finalCategory.split('/').filter(Boolean);
         if (catSegments.length > 2) {
            finalCategory = catSegments.slice(0, 2).join('/');
         }

         const parentSemanticId = slugify(parentResult.title || 'webpage') || crypto.randomUUID();
         const urlFileUid = crypto.randomUUID();
         const parentMdRef = `markdowns/${urlFileUid}-${parentSemanticId}.md`;

         // Save initial parent document
         await docStorage.create(getDocFile(parentMdRef, 'text/markdown') as any, Readable.from([parentResult.markdown]));
         await gitAddIfRepo(path.join(documentStoragePath, parentMdRef));

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
         await gitAddIfRepo(path.join(gitLocalPath, 'content', finalCategory, `${parentSemanticId}.md`));

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
                  const childHtml = await fetchHtmlWithJs(link1);
                  const childRawText = childHtml
                     .replace(/<script[^>]*>([\s\S]*?)<\/script>/gi, '')
                     .replace(/<style[^>]*>([\s\S]*?)<\/style>/gi, '')
                     .replace(/<[^>]+>/g, ' ')
                     .replace(/\s+/g, ' ')
                     .trim();

                  const childPrompt = `You are a professional documentation assistant. Below is the raw text of a sub-page from a website. This sub-page is part of a larger parent document: "${parentResult.title}".
Your task is to:
1. Extract a concise, accurate title for this sub-page.
2. Determine a friendly concept type for this sub-page (e.g. "page", "section", "article", "note"). Use lowercase, singular. Default to "page".
3. Draft a 2-3 sentence summary.
4. Clean and format the raw text into clean, beautiful markdown. Preserve all headings, lists, tables, code blocks, and links.
5. Identify 3-5 relevant keyword tags.

Raw Input Text:
---
${childRawText}
---`;

                  const childResult = await gemini.generateStructured(childPrompt, schema, { model });
                  const rawChildSemanticId = slugify(childResult.title || 'subpage') || crypto.randomUUID();
                  const childSemanticId = `${parentSemanticId}-${rawChildSemanticId}`;
                  const childFileUid = crypto.randomUUID();
                  const childMdRef = `markdowns/${childFileUid}-${childSemanticId}.md`;

                  // Write sub-page markdown
                  await docStorage.create(getDocFile(childMdRef, 'text/markdown') as any, Readable.from([childResult.markdown]));
                  await gitAddIfRepo(path.join(documentStoragePath, childMdRef));

                  const childCategory = `${finalCategory}/${parentSemanticId}`;

                  const childItem = await ContentItem.factory({
                     id: childSemanticId,
                     title: childResult.title,
                     type: childResult.type || 'page',
                     category: childCategory,
                     tags: childResult.tags || [],
                     summary: childResult.summary,
                     parent: parentSemanticId, // Link to parent
                     originalFileUri: link1,
                     markdownFileUri: childMdRef,
                     body: childResult.markdown,
                     createdAt: new Date().toISOString()
                  });
                  await childItem.save();
                  await gitAddIfRepo(path.join(gitLocalPath, 'content', childCategory, `${childSemanticId}.md`));

                  children.push({ id: `${parentSemanticId}/${childSemanticId}`, title: childResult.title, url: link1, level: 1 });

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
                  const childHtml = await fetchHtmlWithJs(link2);
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
                  const rawChildSemanticId = slugify(childResult.title || 'subpage') || crypto.randomUUID();
                  const childSemanticId = `${parentSemanticId}-${rawChildSemanticId}`;
                  const childFileUid = crypto.randomUUID();
                  const childMdRef = `markdowns/${childFileUid}-${childSemanticId}.md`;

                  await docStorage.create(getDocFile(childMdRef, 'text/markdown') as any, Readable.from([childResult.markdown]));
                  await gitAddIfRepo(path.join(documentStoragePath, childMdRef));

                  const childCategory = `${finalCategory}/${parentSemanticId}`;

                  const childItem = await ContentItem.factory({
                     id: childSemanticId,
                     title: childResult.title,
                     type: childResult.type || 'page',
                     category: childCategory,
                     tags: childResult.tags || [],
                     summary: childResult.summary,
                     parent: parentSemanticId, // Link to parent
                     originalFileUri: link2,
                     markdownFileUri: childMdRef,
                     body: childResult.markdown,
                     createdAt: new Date().toISOString()
                  });
                  await childItem.save();
                  await gitAddIfRepo(path.join(gitLocalPath, 'content', childCategory, `${childSemanticId}.md`));

                  children.push({ id: `${parentSemanticId}/${childSemanticId}`, title: childResult.title, url: link2, level: 2 });
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
         const isAudio = task.type === 'audio';

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
         } else if (isAudio) {
            const base64Data = buffer.toString('base64');
            const ext = path.extname(task.tempFilePath).toLowerCase();
            const mimeType = ext === '.wav' ? 'audio/wav' : ext === '.m4a' ? 'audio/x-m4a' : ext === '.ogg' ? 'audio/ogg' : ext === '.webm' ? 'audio/webm' : ext === '.caf' ? 'audio/caf' : 'audio/mpeg';
            mediaPart = {
               inlineData: {
                  mimeType,
                  data: base64Data
               }
            };
         } else {
            let pdfText = '';
            try {
               const pdfData = await pdf(buffer);
               pdfText = pdfData.text || '';
            } catch (err: any) {
               Log.warn(`[Queue] Failed to parse PDF with pdf-parse: ${err.message}`);
            }

            if (pdfText.trim().length < 150) {
               Log.info(`[Queue] PDF "${task.name}" has too little text layer (${pdfText.trim().length} chars). Using direct Gemini multimodal PDF ingestion/OCR.`);
               isScannedPdf = true;
               const base64Data = buffer.toString('base64');
               mediaPart = {
                  inlineData: {
                     mimeType: 'application/pdf',
                     data: base64Data
                  }
               };
            } else {
               rawText = pdfText;
            }
         }
      }

      task.progress = 40;

      let result;

      if (isImage) {
         const imagePrompt = `You are a professional documentation assistant. Below is an uploaded image. Your task is to extract its metadata and transcribe/describe it.

Instructions for fields:
- "title": Clean, concise title.
- "type": Type of concept/document (e.g., screenshot, diagram, sketch, note).
- "summary": A concise 2-3 sentence summary.
- "category": Suggested folder path containing at most 2 levels (e.g., technology/ai, visual/diagrams).
- "tags": Relevant tags.
- "properNouns": List of proper nouns representing people, artists, bands, and collectives. Do NOT include institutions (such as publishing houses, corporations, museums, or universities) or locations/places (such as foundations, cities, or attractions) to prevent polluting the concepts directory.
- "markdown": A detailed Markdown transcription or exhaustive description of the image content, including all text blocks, diagrams, annotations, and visual components.

${task.contextNote ? `Crucial User Context Note:\n- ${task.contextNote}\n` : ''}`;

         result = await gemini.generateStructured([
            { text: imagePrompt },
            mediaPart
         ], schema, { model });
      } else if (task.type === 'audio') {
         const audioPrompt = `You are a professional voice note assistant. Below is an uploaded audio recording (voice note). Your task is to:
1. Generate a high-fidelity, verbatim transcription of everything said in the audio recording under the "markdown" field. Do NOT summarize or skip any words in the transcription. Use proper punctuation and paragraph breaks.
2. Determine a clean, descriptive title for the note based on the content of the recording.
3. Determine a friendly concept type for the document (e.g. "note", "meeting", "reminder", "thought", "journal"). Use lowercase, singular. Default to "note".
4. Draft a 2-3 sentence summary of the recording.
5. Identify 3-5 relevant keyword tags. Format tags as lowercase strings.
6. Under "properNouns", specifically list all proper nouns of people, artists, bands, and collectives mentioned in the audio in their correct capitalization. Do NOT include institutions (such as publishing houses, corporations, museums, or universities) or locations/places (such as foundations, cities, or attractions) to prevent polluting the concepts directory.
7. Determine the date and category of the document:
   - Check if a specific date or relative time of event is clearly stated/spoken in the transcription text (e.g., "hier", "avant-hier", "lundi dernier", "aujourd'hui", "le 15 mars", "le 23 mai").
   - If a date or relative date is mentioned, perform a calendar deduction relative to the System Date/Time context below. For example:
     * If System Date is "2026-07-18" (which is a Saturday) and the audio says "hier", the deducted date is "2026-07-17".
     * If System Date is "2026-07-18" (which is a Saturday) and the audio says "avant-hier", the deducted date is "2026-07-16".
     * If System Date is "2026-07-18" (which is a Saturday) and the audio says "lundi" or "lundi dernier", the deducted date is "2026-07-13".
     * Deduct the correct calendar date and write it in the "deductedDate" field in the format "YYYY-MM-DD".
   - Suggest the category as "journal" (or "journal/personal", "journal/work") if the document is recorded live OR has a clearly stated/deducted date.
   - If NO date or relative date is clearly mentioned/spoken, and the file was an uploaded audio file (Live Recording = No), the category MUST be "inbox" and NOT "journal", and "deductedDate" should be omitted or left blank.
   - Under the "markdown" field, if a date or relative date was clearly mentioned, prefix the markdown content with a header showing the parsed/stated date (e.g., "**Date énoncée :** le 15 mars 2026 (Déduit : 2026-03-15)").
8. Process Geolocation (Note-taking Location):
   - If a note-taking location is provided (Context: Location of Note-Taking is not "Unknown") AND the voice note describes a recent event/thought (e.g., today, yesterday, a few days ago, or a recent trip/meeting/place visiting), you MUST:
     * Add the city name (e.g., "Paris", "Marseille") to the "tags" array so the note is indexable by this place.
     * Add a header line at the very top of the "markdown" field with the location (e.g. "**Lieu de prise de note :** Paris, France").

Context:
- Live Recording: ${task.recordedLive ? 'Yes' : 'No'}
- Current Date/Time (System): ${new Date().toISOString()} (Day of week: ${new Intl.DateTimeFormat('en-US', { weekday: 'long' }).format(new Date())})
- Location of Note-Taking: ${locationContext || 'Unknown'}
${task.contextNote ? `- User Context Note: ${task.contextNote}\n` : ''}`;

         result = await gemini.generateStructured([
            { text: audioPrompt },
            mediaPart
         ], schema, { model });
      } else if (isScannedPdf) {
         const pdfPrompt = `You are a professional documentation assistant. Below is an uploaded scanned or image-only PDF document. Your task is to perform OCR on its pages, extract its metadata, and transcribe its content.

Instructions for fields:
- "title": Clean, concise title of the document.
- "type": Type of concept/document (e.g., diploma, certificate, resume, contract, guide, etc.).
- "summary": A concise 2-3 sentence semantic summary of the document.
- "category": Suggested folder path containing at most 2 levels (e.g., career/diplomas, career/resume).
- "tags": Relevant lowercase tags.
- "properNouns": List of proper nouns representing people, artists, bands, and collectives. Do NOT include institutions (such as publishing houses, corporations, museums, or universities) or locations/places (such as foundations, cities, or attractions) to prevent polluting the concepts directory.
- "markdown": You MUST generate a complete, high-fidelity, and verbatim transcription of the main content of the PDF pages in Markdown. Do NOT summarize the content, do NOT skip sections, signatures, logos, or official stamps. Preserve all text detail and dates exactly as they appear in the original document.

${task.contextNote ? `Crucial User Context Note:\n- ${task.contextNote}\n` : ''}`;

         result = await gemini.generateStructured([
            { text: pdfPrompt },
            mediaPart
         ], schema, { model });
      } else {
         const textPrompt = `You are a professional documentation assistant. Below is a raw document text. Your task is to extract its metadata and structure it.

Instructions for fields:
- "title": Clean, concise title of the document.
- "type": Type of concept/document (e.g., resume, article, guide, recipe, etc.).
- "summary": A concise 2-3 sentence semantic summary of the document.
- "category": Suggested folder path containing at most 2 levels (e.g., career/resume, culinary/recipes).
- "tags": Relevant lowercase tags.
- "properNouns": List of proper nouns representing people, artists, bands, and collectives. Do NOT include institutions (such as publishing houses, corporations, museums, or universities) or locations/places (such as foundations, cities, or attractions) to prevent polluting the concepts directory.
- "markdown": You MUST generate a complete, high-fidelity, and verbatim transcription of the main content in Markdown. Do NOT summarize the content, do NOT skip sections, descriptions, bullet points, or contact info. Preserve all text detail, lists, and dates exactly as they appear in the original text, only cleaning up navigation or visual noise.

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
         let rawRef = '';
         let mimeType = 'application/octet-stream';
         if (isImage) {
            rawRef = `images/${fileUid}-${task.name}`;
            mimeType = 'image/jpeg';
         } else if (task.type === 'audio') {
            rawRef = `audio/${fileUid}-${task.name}`;
            const ext = path.extname(task.name).toLowerCase();
            mimeType = ext === '.wav' ? 'audio/wav' : ext === '.m4a' ? 'audio/x-m4a' : ext === '.ogg' ? 'audio/ogg' : ext === '.webm' ? 'audio/webm' : ext === '.caf' ? 'audio/caf' : 'audio/mpeg';
         } else {
            rawRef = `pdfs/${fileUid}-${task.name}`;
            mimeType = 'application/pdf';
         }
         await docStorage.create(getDocFile(rawRef, mimeType) as any, Readable.from([buffer]));
         await gitAddIfRepo(path.join(documentStoragePath, rawRef));
      }

      await docStorage.create(getDocFile(mdRef, 'text/markdown') as any, Readable.from([result.markdown]));
      await gitAddIfRepo(path.join(documentStoragePath, mdRef));

      let defaultCat = task.type === 'audio' ? (task.recordedLive ? 'journal' : 'inbox') : 'inbox';
      let finalCategory = (task.category && task.category !== 'inbox' && task.category !== 'all') 
         ? task.category 
         : (result.category || defaultCat);

      // Limit category depth to at most 2 levels (parent/child)
      const catSegments = finalCategory.split('/').filter(Boolean);
      if (catSegments.length > 2) {
         finalCategory = catSegments.slice(0, 2).join('/');
      }

      // Check if an item with the same originalFileUri or source URL already exists
      const query = ContentItem.query();
      const existingItemsResult = await ContentItem.repository().query(query);
      const existingItems = existingItemsResult.items || [];
      
      const sourceUrl = task.url;
      const existing = existingItems.find(item => {
         const fileUri = item.val('originalFileUri');
         if (sourceUrl && fileUri === sourceUrl) {
            return true;
         }
         if (task.tempFilePath && fileUri && fileUri.endsWith(task.name)) {
            return true;
         }
         return false;
      });

      const semanticId = existing ? existing.val('id') : (slugify(result.title || originalName) || crypto.randomUUID());
      
      let itemCreatedAt = new Date().toISOString();
      if (!existing && result.deductedDate) {
         try {
            const parsed = new Date(result.deductedDate);
            if (!isNaN(parsed.getTime())) {
               // Shift date to the deducted day, keeping the current time portion
               const now = new Date();
               parsed.setHours(now.getHours(), now.getMinutes(), now.getSeconds(), now.getMilliseconds());
               itemCreatedAt = parsed.toISOString();
               Log.info(`[Queue] Deducted date found: ${result.deductedDate}. Setting createdAt to ${itemCreatedAt}`);
            }
         } catch (e: any) {
            Log.warn(`[Queue] Failed to parse deductedDate "${result.deductedDate}": ${e.message}`);
         }
      } else if (existing) {
         itemCreatedAt = existing.val('createdAt') || new Date().toISOString();
      }

      task.progress = 85;

      const mergedTags = Array.from(new Set([
         ...(result.tags || []),
         ...(result.properNouns || [])
      ]));

      const contentItem = await ContentItem.factory({
         id: semanticId,
         title: result.title || task.name,
         type: result.type || 'note',
         category: finalCategory,
         tags: mergedTags,
         summary: result.summary,
         originalFileUri: task.tempFilePath ? (isImage ? `images/${fileUid}-${task.name}` : task.type === 'audio' ? `audio/${fileUid}-${task.name}` : `pdfs/${fileUid}-${task.name}`) : undefined,
         markdownFileUri: mdRef,
         contextNote: task.contextNote || '',
         body: result.markdown,
         createdAt: itemCreatedAt,
         latitude: task.latitude !== undefined ? task.latitude.toString() : undefined,
         longitude: task.longitude !== undefined ? task.longitude.toString() : undefined
      });

      await contentItem.save();

      if (result.properNouns && Array.isArray(result.properNouns)) {
         const { searchAndCreateConcept } = await import('./concept-autolink');
         for (const properNoun of result.properNouns) {
            searchAndCreateConcept(properNoun).catch(e => {
               Log.warn(`[Queue] Failed to autolink concept "${properNoun}": ${e.message}`);
            });
         }
      }

      await gitAddIfRepo(path.join(gitLocalPath, 'content', finalCategory, `${semanticId}.md`));
   }
}

const GLOBAL_QUEUE_KEY = Symbol.for('__second_brain_queue');
if (!(globalThis as any)[GLOBAL_QUEUE_KEY]) {
   (globalThis as any)[GLOBAL_QUEUE_KEY] = new QueueManagerClass();
} else {
   Object.setPrototypeOf((globalThis as any)[GLOBAL_QUEUE_KEY], QueueManagerClass.prototype);
}

export const QueueManager = (globalThis as any)[GLOBAL_QUEUE_KEY] as QueueManagerClass;
