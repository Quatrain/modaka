import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import { Readable } from 'node:stream';
import { Log } from '@quatrain/log';
import { Storage } from '@quatrain/storage';
import { Backend } from '@quatrain/backend';
import { Ingestion } from '@quatrain/ingestion';
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

         const webAdapter = Ingestion.getAdapter('web');
         const parentResult = await webAdapter.process(rawText, {
            contextNote: task.contextNote,
            model
         });
         
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

                  const childResult = await webAdapter.process(childRawText, {
                     contextNote: `Ce document est une sous-page (Niveau 1) du document parent "${parentResult.title}".`,
                     model
                  });
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

                  const childResult = await webAdapter.process(childRawText, {
                     contextNote: `Ce document est une sous-page (Niveau 2) du document parent "${parentResult.title}".`,
                     model
                  });
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
      }

      task.progress = 40;

      let result;

      if (task.type === 'audio') {
         const audioAdapter = Ingestion.getAdapter('audio');
         const ext = task.tempFilePath ? path.extname(task.tempFilePath).toLowerCase() : '.wav';
         const mimeType = ext === '.wav' ? 'audio/wav' : ext === '.m4a' ? 'audio/x-m4a' : ext === '.ogg' ? 'audio/ogg' : ext === '.webm' ? 'audio/webm' : ext === '.caf' ? 'audio/caf' : 'audio/mpeg';

         result = await audioAdapter.process(buffer!, {
            mimeType,
            recordedLive: task.recordedLive,
            locationContext: locationContext || 'Unknown',
            contextNote: task.contextNote,
            model
         });
      } else {
         const ocrAdapter = Ingestion.getAdapter('ocr');
         if (isImage) {
            const ext = task.tempFilePath ? path.extname(task.tempFilePath).toLowerCase() : '.jpg';
            const mimeType = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg';
            result = await ocrAdapter.process(buffer!, {
               isImage: true,
               mimeType,
               contextNote: task.contextNote,
               model
            });
         } else {
            // Either PDF or Text
            const isPdf = task.type === 'pdf' || (task.tempFilePath && task.tempFilePath.endsWith('.pdf'));
            if (isPdf && buffer) {
               result = await ocrAdapter.process(buffer, {
                  isImage: false,
                  mimeType: 'application/pdf',
                  contextNote: task.contextNote,
                  model
               });
            } else {
               result = await ocrAdapter.process(rawText, {
                  contextNote: task.contextNote,
                  model
               });
            }
         }
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
