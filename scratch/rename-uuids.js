import fs from 'fs-extra';
import path from 'path';
import yaml from 'yaml';
import { execSync } from 'child_process';

const DATA_DIR = '/Users/crapougnax/CODE/CRAPOUGNAX/second-brain-data';
const CONTENT_DIR = path.join(DATA_DIR, 'content');

// Helper to slugify
function slugify(text) {
   if (!text) return '';
   return text
      .toString()
      .toLowerCase()
      .normalize('NFD') // decompose unicode characters
      .replace(/[\u0300-\u036f]/g, '') // remove accent symbols
      .replace(/[^a-z0-9\s-]/g, '') // remove special chars
      .replace(/[\s_]+/g, '-') // spaces/underscores to hyphens
      .replace(/-+/g, '-') // collapse consecutive hyphens
      .trim()
      .replace(/^-+|-+$/g, ''); // trim hyphens from start/end
}

const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

async function run() {
   console.log('Scanning files...');
   const mdFiles = await walk(CONTENT_DIR);
   console.log(`Found ${mdFiles.length} Markdown files.`);

   let renamedCount = 0;

   for (const file of mdFiles) {
      const ext = path.extname(file);
      const base = path.basename(file, ext);
      
      if (!uuidRegex.test(base)) {
         continue;
      }

      console.log(`Processing UUID file: ${file}`);
      const content = await fs.readFile(file, 'utf8');
      
      // Parse YAML frontmatter
      const parts = content.split('---');
      if (parts.length < 3) {
         console.warn(`File has invalid frontmatter: ${file}`);
         continue;
      }

      const rawYaml = parts[1];
      const body = parts.slice(2).join('---');

      let frontmatter;
      try {
         frontmatter = yaml.parse(rawYaml);
      } catch (err) {
         console.error(`Failed to parse YAML in ${file}:`, err.message);
         continue;
      }

      const title = frontmatter.title || 'untitled';
      let semanticId = slugify(title);
      if (!semanticId) {
         semanticId = 'concept-' + base;
      }

      // Check if another file with this new name already exists
      const dir = path.dirname(file);
      let newFile = path.join(dir, `${semanticId}.md`);
      
      // If it exists, append a short hash or number
      let counter = 1;
      while (await fs.pathExists(newFile) && newFile !== file) {
         newFile = path.join(dir, `${semanticId}-${counter}.md`);
         counter++;
      }

      const newBase = path.basename(newFile, '.md');
      console.log(`Renaming: ${base}.md -> ${newBase}.md`);

      // Update frontmatter id, uid, and path if it references the old filename
      frontmatter.id = newBase;
      frontmatter.uid = newBase;
      
      // Re-serialize YAML
      const updatedYaml = yaml.stringify(frontmatter);
      const newContent = `---\n${updatedYaml}---\n${body}`;

      // Write updated content to original file before rename
      await fs.writeFile(file, newContent, 'utf8');

      // Use git mv to perform the rename
      try {
         const relOld = path.relative(DATA_DIR, file);
         const relNew = path.relative(DATA_DIR, newFile);
         execSync(`git mv "${relOld}" "${relNew}"`, { cwd: DATA_DIR });
         console.log(`Git mv successful: ${relOld} -> ${relNew}`);
         renamedCount++;
      } catch (err) {
         console.warn(`Git mv failed, falling back to fs.rename:`, err.message);
         await fs.rename(file, newFile);
         renamedCount++;
      }
   }

   console.log(`Migration finished. Renamed ${renamedCount} files.`);
}

run().catch(console.error);
