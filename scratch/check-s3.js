import { initBackend } from '../src/lib/backend.js';
import { Storage } from '@quatrain/storage';

initBackend();

const docStorage = Storage.getStorage('document-storage');
const ref = 'markdowns/ed09c3db-8f17-44e5-a23d-e6249acc7e31-empty-sub-page-content.md';
const file = {
   bucket: process.env.S3_BUCKET || 'second-brain',
   ref,
   name: 'ed09c3db-8f17-44e5-a23d-e6249acc7e31-empty-sub-page-content.md'
};

try {
   const meta = await docStorage.getMetaData(file);
   console.log('File found in S3! Meta:', meta);
} catch (e) {
   console.log('File not found in S3:', e.message);
}
