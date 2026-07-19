import { Log, DefaultLoggerAdapter, LogLevel } from '@quatrain/log';
import { Backend, InjectMetaMiddleware } from '@quatrain/backend';
import { OKFBackendAdapter } from '@quatrain/okf';
import { Storage } from '@quatrain/storage';
import { GitStorageAdapter } from '@quatrain/storage-git';
import { LocalStorageAdapter } from '@quatrain/storage-local';
import { S3StorageAdapter } from '@quatrain/storage-s3';
import { AstroAdapter } from '@quatrain/api-server-astro';
import { CrudEndpoint, ValuesEndpoint, ListEndpoint } from '@quatrain/api-server';
import { ContentItem } from './models/ContentItem';
import { Ai } from '@quatrain/ai';
import { GeminiAdapter } from '@quatrain/ai-gemini';
import { Ingestion } from '@quatrain/ingestion';
import { OcrIngestionAdapter } from '@quatrain/ingestion-ocr';
import { AudioIngestionAdapter } from '@quatrain/ingestion-audio';
import { WebIngestionAdapter } from '@quatrain/ingestion-web';
import { Queue } from '@quatrain/queue';
import { SQLiteQueueAdapter } from '@quatrain/queue-sqlite';
import * as path from 'node:path';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import * as fs from 'node:fs/promises';
import * as fsSync from 'node:fs';

import dotenv from 'dotenv';

dotenv.config();

const execPromise = promisify(exec);
const GIT_SYNC_LOCK_KEY = Symbol.for('__second_brain_git_sync_lock');

async function updateReadmeChangelog(localPath: string) {
   try {
      // Check if origin/main exists
      let hasOriginMain = false;
      try {
         await execPromise('git rev-parse --verify origin/main', { cwd: localPath });
         hasOriginMain = true;
      } catch (e) {
         // origin/main doesn't exist yet
      }

      const logRange = hasOriginMain ? 'origin/main..HEAD' : 'HEAD';
      // Format: YYYY-MM-DD: Commit message
      const { stdout } = await execPromise(
         `git log ${logRange} --pretty=format:"* **%cd** : %s" --date=format:"%Y-%m-%d"`,
         { cwd: localPath }
      );

      const newEntries = stdout.trim();
      if (!newEntries) return; // No new commits to log

      // Read current README.md
      const readmePath = path.join(localPath, 'README.md');
      let currentContent = '';
      try {
         currentContent = await fs.readFile(readmePath, 'utf-8');
      } catch (e) {
         currentContent = '# second-brain-data\n';
      }

      const newLines = newEntries.split('\n').filter(line => line.trim().startsWith('*'));
      if (newLines.length === 0) return;

      const header = '## Journal des modifications';
      let headerIndex = currentContent.indexOf(header);
      let updatedContent = '';

      if (headerIndex === -1) {
         updatedContent = currentContent.trim() + '\n\n' + header + '\n\n' + newLines.join('\n') + '\n';
      } else {
         const beforeHeader = currentContent.substring(0, headerIndex + header.length);
         const afterHeader = currentContent.substring(headerIndex + header.length).trim();
         
         const existingLines = afterHeader.split('\n').map(l => l.trim()).filter(l => l.length > 0);
         const uniqueNewLines = newLines.filter(line => !existingLines.includes(line.trim()));

         if (uniqueNewLines.length === 0) return; // No new unique lines

         updatedContent = beforeHeader.trim() + '\n\n' + uniqueNewLines.join('\n') + '\n' + (existingLines.length > 0 ? existingLines.join('\n') + '\n' : '');
      }

      await fs.writeFile(readmePath, updatedContent, 'utf-8');
      await execPromise('git add README.md', { cwd: localPath });
      await execPromise('git commit -m "docs: update changelog in README.md [skip ci]"', { cwd: localPath });
      Log.info('[Git Sync] Changelog updated in README.md');
   } catch (err: any) {
      Log.warn(`[Git Sync] Failed to update README.md changelog: ${err.message}`);
   }
}

async function syncGitRepository(localPath: string) {
   if ((globalThis as any)[GIT_SYNC_LOCK_KEY]) {
      Log.debug(`[Git Sync] Sync already in progress, skipping`);
      return;
   }
   (globalThis as any)[GIT_SYNC_LOCK_KEY] = true;
   try {
      Log.info(`[Git Sync] Synchronisant le dépôt Git local-first...`);
      await execPromise('git fetch origin', { cwd: localPath });
      
      // Update changelog in README.md based on new local commits before pulling/pushing
      await updateReadmeChangelog(localPath);

      await execPromise('git pull --rebase origin main', { cwd: localPath });
      await execPromise('git push origin main', { cwd: localPath });
      Log.info(`[Git Sync] Synchronisation terminée avec succès`);
   } catch (err: any) {
      Log.warn(`[Git Sync] Échec de la synchronisation en arrière-plan : ${err.message}`);
   } finally {
      (globalThis as any)[GIT_SYNC_LOCK_KEY] = false;
   }
}

let initialized = false;
export let astroAdapter: AstroAdapter;

export function initBackend() {
   if (initialized) return;

   const isProd = process.env.NODE_ENV === 'production';
   Log.addLogger('default', new DefaultLoggerAdapter('', isProd ? LogLevel.INFO : LogLevel.DEBUG), true);

   const geminiApiKey = process.env.GEMINI_API_KEY;
   if (geminiApiKey) {
      Ai.setAdapter(new GeminiAdapter(geminiApiKey));
      Log.info('AI adapter registered successfully');
   } else {
      Log.warn('GEMINI_API_KEY is not configured, AI adapter not set');
   }

   const gitMode = (process.env.GIT_MODE as 'local' | 'github') || 'local';
   const gitLocalPath = process.env.GIT_LOCAL_PATH || path.resolve(process.cwd(), '.second-brain-git');
   const documentStoragePath = process.env.DOCUMENT_STORAGE_PATH || path.resolve(process.cwd(), '.second-brain-docs');

    // 1. Initialize Document Storage (S3StorageAdapter with LocalStorageAdapter fallback)
    let docAdapter: any;
    if (process.env.S3_ACCESS_KEY && process.env.S3_SECRET_KEY) {
       docAdapter = new S3StorageAdapter({
          config: {
             region: process.env.S3_REGION || 'us-east-1',
             endpoint: process.env.S3_ENDPOINT,
             accesskey: process.env.S3_ACCESS_KEY,
             secret: process.env.S3_SECRET_KEY,
             bucket: process.env.S3_BUCKET || 'second-brain'
          }
       } as any);
       Log.info(`Document storage configured with S3StorageAdapter on bucket '${process.env.S3_BUCKET || 'second-brain'}'`);
    } else {
       docAdapter = new LocalStorageAdapter({
          config: { bucket: 'documents' },
          basePath: documentStoragePath
       } as any);
       Log.info('Document storage configured with LocalStorageAdapter (S3 environment variables not set)');
    }
    Storage.addStorage(docAdapter, 'document-storage', false);

   // 2. Initialize Git Metadata Storage (GitStorageAdapter)
   const gitAdapter = new GitStorageAdapter({
      config: {
         mode: gitMode,
         localPath: gitLocalPath,
         githubToken: process.env.GIT_GITHUB_TOKEN,
         owner: process.env.GIT_REPO_OWNER,
         repo: process.env.GIT_REPO_NAME,
         branch: process.env.GIT_BRANCH || 'main',
         bucket: 'metadata',
         noPush: true
      }
   } as any);
   Storage.addStorage(gitAdapter, 'git-storage', true);

   // 3. Initialize OKF Backend Adapter delegating to git-storage
   const okfAdapter = new OKFBackendAdapter({
      config: {
         database: gitLocalPath, // Fallback if no storage is active
         storage: 'git-storage'
      },
      middlewares: [new InjectMetaMiddleware()]
   });

   Backend.addBackend(okfAdapter, 'default', true);

   // 4. Initialize API Server Astro Adapter
   astroAdapter = new AstroAdapter();

   // Register endpoint for ContentItem
   const ContentItemApi = (router: any, rootPath: string, options: any) => {
      CrudEndpoint(ContentItem)(router, rootPath, options);
      ValuesEndpoint(ContentItem)(router, rootPath, options);
      ListEndpoint(ContentItem)(router, rootPath, options);
   };

   astroAdapter.addEndpoint(ContentItemApi, '/api/content');

   // 5. Initialize Ingestion Adapters
   Ingestion.addAdapter(new OcrIngestionAdapter(), 'ocr');
   Ingestion.addAdapter(new AudioIngestionAdapter(), 'audio');
   Ingestion.addAdapter(new WebIngestionAdapter(), 'web');

   // 6. Initialize Queue Adapter
   const queueDbDir = path.resolve(process.cwd(), '.queue');
   const queueDbPath = path.join(queueDbDir, 'queue.sqlite');
   try {
      fsSync.mkdirSync(queueDbDir, { recursive: true });
   } catch (e) {
      // directory already exists or error
   }
   Queue.addQueue(new SQLiteQueueAdapter({
      config: { database: queueDbPath }
   }), 'default', true);

   // Start background synchronization in local mode
   if (gitMode === 'local' && gitLocalPath) {
      const GIT_SYNC_INTERVAL_KEY = Symbol.for('__second_brain_git_sync_interval');
      if (!(globalThis as any)[GIT_SYNC_INTERVAL_KEY]) {
         syncGitRepository(gitLocalPath);
         const interval = setInterval(() => {
            syncGitRepository(gitLocalPath);
         }, 30000);
         if (interval && typeof interval.unref === 'function') {
            interval.unref();
         }
         (globalThis as any)[GIT_SYNC_INTERVAL_KEY] = interval;
      }
   }

   import('./queue').then(({ QueueManager }) => {
      QueueManager.startListening();
   }).catch(err => {
      Log.error(`[Backend] Failed to start QueueManager listener: ${err.message}`);
   });

   initialized = true;
}
