import fs from 'fs-extra';
import path from 'path';
import yaml from 'yaml';
import { execSync } from 'child_process';

const DATA_DIR = '/Users/crapougnax/CODE/CRAPOUGNAX/second-brain-data';
const CONTENT_DIR = path.join(DATA_DIR, 'content');

async function walk(dir) {
   let files = [];
   const list = await fs.readdir(dir);
   for (const item of list) {
      const fullPath = path.join(dir, item);
      const stat = await fs.stat(fullPath);
      if (stat.isDirectory()) {
         files = files.concat(await walk(fullPath));
      } else if (item.endsWith('.md') && item !== 'index.md') {
         files.push(fullPath);
      }
   }
   return files;
}

// Helper to slugify
function slugify(text) {
   if (!text) return '';
   return text
      .toString()
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9\s-]/g, '')
      .replace(/[\s_]+/g, '-')
      .replace(/-+/g, '-')
      .trim()
      .replace(/^-+|-+$/g, '');
}

async function run() {
   console.log('Scanning files for duplicates...');
   const mdFiles = await walk(CONTENT_DIR);
   
   const docs = [];

   for (const file of mdFiles) {
      const content = await fs.readFile(file, 'utf8');
      const parts = content.split('---');
      if (parts.length < 3) continue;

      const rawYaml = parts[1];
      let frontmatter;
      try {
         frontmatter = yaml.parse(rawYaml);
      } catch (err) {
         continue;
      }

      docs.push({
         file,
         frontmatter,
         contentSize: content.length,
         title: frontmatter.title || '',
         category: frontmatter.category || '',
         originalFileUri: frontmatter.originalFileUri || null,
         timestamp: frontmatter.timestamp ? new Date(frontmatter.timestamp).getTime() : 0
      });
   }

   // Group by originalFileUri (for crawled web pages)
   const urlGroups = {};
   // Group by category + slugified title (for files without URLs)
   const titleGroups = {};

   for (const doc of docs) {
      if (doc.originalFileUri) {
         if (!urlGroups[doc.originalFileUri]) {
            urlGroups[doc.originalFileUri] = [];
         }
         urlGroups[doc.originalFileUri].push(doc);
      } else {
         const key = `${doc.category}/${slugify(doc.title)}`;
         if (!titleGroups[key]) {
            titleGroups[key] = [];
         }
         titleGroups[key].push(doc);
      }
   }

   let deletedCount = 0;

   // Process URL groups
   for (const [url, list] of Object.entries(urlGroups)) {
      if (list.length > 1) {
         console.log(`\nDuplicate URL found: ${url} (${list.length} files)`);
         
         // Sort to determine which one to KEEP:
         // 1. Prefer files that do NOT end with -[0-9].md
         // 2. Prefer larger file size (more content)
         // 3. Prefer newer timestamp
         list.sort((a, b) => {
            const aEndsWithNum = /-\d+\.md$/.test(a.file);
            const bEndsWithNum = /-\d+\.md$/.test(b.file);
            if (aEndsWithNum && !bEndsWithNum) return 1;
            if (!aEndsWithNum && bEndsWithNum) return -1;
            
            // Prefer larger content size
            if (b.contentSize !== a.contentSize) {
               return b.contentSize - a.contentSize;
            }
            // Prefer newer timestamp
            return b.timestamp - a.timestamp;
         });

         const keepDoc = list[0];
         console.log(`KEEP: ${path.relative(DATA_DIR, keepDoc.file)} (size: ${keepDoc.contentSize})`);

         for (let i = 1; i < list.length; i++) {
            const dupDoc = list[i];
            console.log(`DELETE: ${path.relative(DATA_DIR, dupDoc.file)} (size: ${dupDoc.contentSize})`);
            try {
               const relPath = path.relative(DATA_DIR, dupDoc.file);
               execSync(`git rm -f "${relPath}"`, { cwd: DATA_DIR });
               deletedCount++;
            } catch (err) {
               console.warn(`Git rm failed, deleting from fs:`, err.message);
               await fs.unlink(dupDoc.file);
               deletedCount++;
            }
         }
      }
   }

   // Process Title groups
   for (const [key, list] of Object.entries(titleGroups)) {
      if (list.length > 1) {
         console.log(`\nDuplicate Title key found: ${key} (${list.length} files)`);
         
         list.sort((a, b) => {
            const aEndsWithNum = /-\d+\.md$/.test(a.file);
            const bEndsWithNum = /-\d+\.md$/.test(b.file);
            if (aEndsWithNum && !bEndsWithNum) return 1;
            if (!aEndsWithNum && bEndsWithNum) return -1;
            
            if (b.contentSize !== a.contentSize) {
               return b.contentSize - a.contentSize;
            }
            return b.timestamp - a.timestamp;
         });

         const keepDoc = list[0];
         console.log(`KEEP: ${path.relative(DATA_DIR, keepDoc.file)}`);

         for (let i = 1; i < list.length; i++) {
            const dupDoc = list[i];
            console.log(`DELETE: ${path.relative(DATA_DIR, dupDoc.file)}`);
            try {
               const relPath = path.relative(DATA_DIR, dupDoc.file);
               execSync(`git rm -f "${relPath}"`, { cwd: DATA_DIR });
               deletedCount++;
            } catch (err) {
               console.warn(`Git rm failed, deleting from fs:`, err.message);
               await fs.unlink(dupDoc.file);
               deletedCount++;
            }
         }
      }
   }

   console.log(`\nDeduplication finished. Removed ${deletedCount} duplicate files.`);
}

run().catch(console.error);
