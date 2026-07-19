import { describe, it, expect, vi, beforeEach } from 'vitest';
import { gitAddIfRepo } from './git';
import { exec } from 'node:child_process';

vi.mock('node:child_process', () => {
   return {
      exec: vi.fn(),
   };
});

describe('gitAddIfRepo', () => {
   beforeEach(() => {
      vi.resetAllMocks();
   });

   it('should run git add if inside git repository', async () => {
      const mockExec = exec as any;
      mockExec.mockImplementation((cmd: string, options: any, callback: Function) => {
         if (cmd.includes('rev-parse')) {
            callback(null, { stdout: 'true\n' });
         } else {
            callback(null, { stdout: '' });
         }
      });

      await gitAddIfRepo('/fake/path/file.txt');
      expect(mockExec).toHaveBeenCalledWith(
         'git rev-parse --is-inside-work-tree',
         { cwd: '/fake/path' },
         expect.any(Function)
      );
      expect(mockExec).toHaveBeenCalledWith(
         'git add "file.txt"',
         { cwd: '/fake/path' },
         expect.any(Function)
      );
   });

   it('should skip git add if not inside git repository', async () => {
      const mockExec = exec as any;
      mockExec.mockImplementation((cmd: string, options: any, callback: Function) => {
         if (cmd.includes('rev-parse')) {
            callback(null, { stdout: 'false\n' });
         } else {
            callback(null, { stdout: '' });
         }
      });

      await gitAddIfRepo('/fake/path/file.txt');
      expect(mockExec).toHaveBeenCalledWith(
         'git rev-parse --is-inside-work-tree',
         { cwd: '/fake/path' },
         expect.any(Function)
      );
      expect(mockExec).not.toHaveBeenCalledWith(
         'git add "file.txt"',
         expect.any(Object),
         expect.any(Function)
      );
   });
});
