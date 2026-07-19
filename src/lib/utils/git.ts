import * as path from 'node:path';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { Queue } from '@quatrain/queue';

const execPromise = promisify(exec);

/**
 * Conditionally runs `git add` on a file if it is located inside an active Git repository.
 */
export async function gitAddIfRepo(filePath: string): Promise<void> {
   const dir = path.dirname(filePath);
   try {
      const { stdout } = await execPromise('git rev-parse --is-inside-work-tree', { cwd: dir });
      if (stdout.trim() === 'true') {
         await execPromise(`git add "${path.basename(filePath)}"`, { cwd: dir });
         Queue.info(`[Git] Added file to index: ${filePath}`);
      }
   } catch (e) {
      // not a git repo or git not found, ignore silently
   }
}
