import { Log, DefaultLoggerAdapter, LogLevel } from '@quatrain/log';
import { Backend, InjectMetaMiddleware } from '@quatrain/backend';
import { OKFBackendAdapter } from '@quatrain/okf';
import { Storage } from '@quatrain/storage';
import { GitStorageAdapter } from '@quatrain/storage-git';
import { LocalStorageAdapter } from '@quatrain/storage-local';
import { AstroAdapter } from '@quatrain/api-server-astro';
import { CrudEndpoint, ValuesEndpoint, ListEndpoint } from '@quatrain/api-server';
import { ContentItem } from './models/ContentItem';
import { Ai } from '@quatrain/ai';
import { GeminiAdapter } from '@quatrain/ai-gemini';
import * as path from 'node:path';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';

import dotenv from 'dotenv';

dotenv.config();

const execPromise = promisify(exec);
let syncInterval: NodeJS.Timeout | null = null;

async function syncGitRepository(localPath: string) {
   try {
      Log.info(`[Git Sync] Synchronisant le dépôt Git local-first...`);
      await execPromise('git fetch origin', { cwd: localPath });
      await execPromise('git pull --rebase origin main', { cwd: localPath });
      await execPromise('git push origin main', { cwd: localPath });
      Log.info(`[Git Sync] Synchronisation terminée avec succès`);
   } catch (err: any) {
      Log.warn(`[Git Sync] Échec de la synchronisation en arrière-plan : ${err.message}`);
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

   // 1. Initialize Document Storage (LocalStorageAdapter)
   const docAdapter = new LocalStorageAdapter({
      config: { bucket: 'documents' },
      basePath: documentStoragePath
   } as any);
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
         bucket: 'metadata'
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

   // Start background synchronization in local mode
   if (gitMode === 'local' && gitLocalPath) {
      syncGitRepository(gitLocalPath);
      syncInterval = setInterval(() => {
         syncGitRepository(gitLocalPath);
      }, 30000);
      if (syncInterval && typeof syncInterval.unref === 'function') {
         syncInterval.unref();
      }
   }

   initialized = true;
}
