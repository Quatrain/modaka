import React, { useState, useEffect, useRef } from '@quatrain/ux-react';
import { 
   IconMessage, 
   IconFileText, 
   IconDownload, 
   IconUpload, 
   IconSend, 
   IconFolder, 
   IconTag,
   IconLoader2,
   IconCircleCheck,
   IconCamera,
   IconRefresh
} from '@tabler/icons-react';

interface ContentItemData {
   id: string;
   title?: string;
   category?: string;
   tags?: string[];
   summary?: string;
   originalFileUri?: string;
   markdownFileUri?: string;
   createdAt?: string;
}

interface Message {
   role: 'user' | 'assistant';
   content: string;
}

export default function Dashboard() {
   const [activeTab, setActiveTab] = useState<'chat' | 'docs' | 'stats'>('chat');
   const [documents, setDocuments] = useState<ContentItemData[]>([]);
   const [uploading, setUploading] = useState(false);
   const [uploadSuccess, setUploadSuccess] = useState(false);
   const [selectedDoc, setSelectedDoc] = useState<ContentItemData | null>(null);
   const [categoryFilter, setCategoryFilter] = useState<string>('all');
   const [showUploadModal, setShowUploadModal] = useState(false);
   const [reindexing, setReindexing] = useState(false);
   const [queueTasks, setQueueTasks] = useState<any[]>([]);
   const [crawlDepth, setCrawlDepth] = useState<number>(0);

   // Import state
   const [importType, setImportType] = useState<'pdf' | 'image' | 'url' | 'text'>('pdf');
   const [selectedFile, setSelectedFile] = useState<File | null>(null);
   const [urlInput, setUrlInput] = useState('');
   const [markdownInput, setMarkdownInput] = useState('');
   const [contextNoteInput, setContextNoteInput] = useState('');
   const [addingUrl, setAddingUrl] = useState(false);

   // Onboarding state
   const [selectedInterests, setSelectedInterests] = useState<string[]>([]);
   const [expandedInterests, setExpandedInterests] = useState<string[]>([]);
   const [onboardingOptions, setOnboardingOptions] = useState<any[]>([]);
   const [initializing, setInitializing] = useState(false);

   // Chat state
   const [messages, setMessages] = useState<Message[]>([
      { role: 'assistant', content: 'Bonjour ! Je suis votre Second Brain Copilot. Vous pouvez uploader des PDFs dans l\'onglet "Documents" pour que je puisse les synthétiser et y accéder, ou simplement me poser des questions.' }
   ]);
   const [inputMessage, setInputMessage] = useState('');
   const [sending, setSending] = useState(false);
   const chatEndRef = useRef<HTMLDivElement>(null);

   useEffect(() => {
      fetchDocuments();
      fetchOnboardingOptions();
      fetchQueue();
   }, []);

   useEffect(() => {
      // Poll queue state if any task is pending or processing
      const hasActiveTasks = queueTasks.some(t => t.status === 'pending' || t.status === 'processing');
      if (hasActiveTasks) {
         const timer = setInterval(() => {
            fetchQueue();
            fetchDocuments();
         }, 2000);
         return () => clearInterval(timer);
      }
   }, [queueTasks]);

   const fetchQueue = async () => {
      try {
         const res = await fetch('/api/queue');
         if (res.ok) {
            const data = await res.json();
            setQueueTasks(data.tasks || []);
         }
      } catch (err) {
         console.error('Failed to fetch queue', err);
      }
   };

   useEffect(() => {
      if (activeTab === 'chat') {
         chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
      }
   }, [messages, activeTab]);

   const fetchDocuments = async () => {
      try {
         const res = await fetch('/api/content');
         if (res.ok) {
            const data = await res.json();
            const items = (data.items || []).map((item: any) => ({
               ...item,
               id: item.uid || item.id
            }));
            setDocuments(items);
         }
      } catch (err) {
         console.error('Failed to fetch documents', err);
      }
   };

   const fetchOnboardingOptions = async () => {
      try {
         const res = await fetch('/api/initialize');
         if (res.ok) {
            const data = await res.json();
            setOnboardingOptions(data.options || []);
         }
      } catch (err) {
         console.error('Failed to fetch onboarding options', err);
      }
   };   // Unified Import Action (PDF upload or URL import with context note)
   const handleUnifiedImport = async (e: React.FormEvent) => {
      e.preventDefault();
      
      if (importType === 'url') {
         if (!urlInput.trim()) return;
         setAddingUrl(true);
         setUploadSuccess(false);
         try {
            const res = await fetch('/api/url', {
               method: 'POST',
               headers: { 'Content-Type': 'application/json' },
               body: JSON.stringify({ 
                  url: urlInput.trim(), 
                  category: categoryFilter === 'all' ? 'inbox' : categoryFilter,
                  contextNote: contextNoteInput.trim(),
                  crawlDepth
               })
            });

            if (res.ok) {
               const data = await res.json();
               setUrlInput('');
               setContextNoteInput('');
               setUploadSuccess(true);
               setShowUploadModal(false);
               fetchQueue();
               setMessages(prev => [
                  ...prev,
                  { role: 'assistant', content: `Importation de l'URL lancée en arrière-plan. Vous pouvez suivre la tâche dans la file d'attente d'importation.` }
               ]);
               setTimeout(() => setUploadSuccess(false), 2000);
            } else {
               const err = await res.json();
               alert(err.error || "Erreur lors de l'ajout de l'URL");
            }
         } catch (err) {
            console.error('Failed to ingest URL', err);
            alert("Impossible de contacter le serveur d'ingestion");
         } finally {
            setAddingUrl(false);
         }
      } else if (importType === 'text') {
         if (!markdownInput.trim()) return;
         setUploading(true);
         setUploadSuccess(false);

         const formData = new FormData();
         formData.append('textContent', markdownInput.trim());
         formData.append('category', categoryFilter === 'all' ? 'inbox' : categoryFilter);
         formData.append('contextNote', contextNoteInput.trim());

         try {
            const res = await fetch('/api/upload', {
               method: 'POST',
               body: formData
            });
            if (res.ok) {
               const data = await res.json();
               setMarkdownInput('');
               setContextNoteInput('');
               setUploadSuccess(true);
               setShowUploadModal(false);
               fetchQueue();
               setMessages(prev => [
                  ...prev,
                  { role: 'assistant', content: `Traitement du texte collé lancé en arrière-plan. Vous pouvez suivre l'avancement dans la file d'attente.` }
               ]);
               setTimeout(() => setUploadSuccess(false), 3000);
            } else {
               const errData = await res.json();
               alert(`Erreur d'importation du texte: ${errData.error}`);
            }
         } catch (err) {
            alert('Erreur réseau lors de l\'importation');
         } finally {
            setUploading(false);
         }
      } else {
         if (!selectedFile) return;
         setUploading(true);
         setUploadSuccess(false);

         const formData = new FormData();
         formData.append('file', selectedFile);
         formData.append('category', categoryFilter === 'all' ? 'inbox' : categoryFilter);
         formData.append('contextNote', contextNoteInput.trim());

         try {
            const res = await fetch('/api/upload', {
               method: 'POST',
               body: formData
            });
            if (res.ok) {
               const data = await res.json();
               setSelectedFile(null);
               setContextNoteInput('');
               setUploadSuccess(true);
               setShowUploadModal(false);
               fetchQueue();
               setMessages(prev => [
                  ...prev,
                  { role: 'assistant', content: `Traitement du fichier "${selectedFile.name}" lancé en arrière-plan. Suivez l'analyse dans la file d'attente d'importation.` }
               ]);
               setTimeout(() => setUploadSuccess(false), 3000);
            } else {
               const errData = await res.json();
               alert(`Erreur d'upload: ${errData.error}`);
            }
         } catch (err) {
            alert('Erreur réseau lors de l\'upload');
         } finally {
            setUploading(false);
         }
      }
   };

   // Onboarding initialization
   const handleInitializeOnboarding = async () => {
      if (selectedInterests.length === 0) {
         alert('Veuillez sélectionner au moins un centre d\'intérêt pour démarrer.');
         return;
      }
      setInitializing(true);
      try {
         const res = await fetch('/api/initialize', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ categories: selectedInterests })
         });
         if (res.ok) {
            fetchDocuments();
         } else {
            const err = await res.json();
            alert(`Erreur d'initialisation: ${err.error}`);
         }
      } catch (err) {
         alert('Erreur réseau lors de l\'initialisation');
      } finally {
         setInitializing(false);
      }
   };

   // Send Message to Copilot
   const handleSendMessage = async (e: React.FormEvent) => {
      e.preventDefault();
      if (!inputMessage.trim() || sending) return;

      const userText = inputMessage;
      setInputMessage('');
      setMessages(prev => [...prev, { role: 'user', content: userText }]);
      setSending(true);

      try {
         const updatedMessages = [...messages, { role: 'user', content: userText }];
         const res = await fetch('/api/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ messages: updatedMessages })
         });

         if (res.ok) {
            const data = await res.json();
            setMessages(prev => [...prev, { role: 'assistant', content: data.response }]);
         } else {
            setMessages(prev => [...prev, { role: 'assistant', content: 'Désolé, une erreur est survenue lors de la communication avec mon processeur Gemini.' }]);
         }
      } catch (err) {
         setMessages(prev => [...prev, { role: 'assistant', content: 'Erreur de connexion. Impossible de contacter le serveur.' }]);
      } finally {
         setSending(false);
      }
   };

   // Update category of document
   const handleUpdateCategory = async (doc: ContentItemData, newCat: string) => {
      try {
         const res = await fetch(`/api/content/${doc.id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ...doc, category: newCat })
         });
         if (res.ok) {
            setDocuments(prev => prev.map(d => d.id === doc.id ? { ...d, category: newCat } : d));
            if (selectedDoc && selectedDoc.id === doc.id) {
               setSelectedDoc({ ...selectedDoc, category: newCat });
            }
         }
      } catch (err) {
         console.error('Failed to update category', err);
      }
   };

   // Delete document
   const handleDeleteDoc = async (id: string) => {
      if (!confirm('Voulez-vous supprimer ce document ?')) return;

      try {
         const res = await fetch(`/api/content/${id}`, {
            method: 'DELETE'
         });
         if (res.ok) {
            setDocuments(prev => prev.filter(d => d.id !== id));
            setSelectedDoc(null);
         }
      } catch (err) {
         console.error('Failed to delete document', err);
      }
   };

   // Reindex all directories
   const handleReindex = async () => {
      setReindexing(true);
      try {
         const res = await fetch('/api/reindex', {
            method: 'POST'
         });
         if (res.ok) {
            alert('Réindexation des dossiers terminée avec succès !');
            fetchDocuments();
         } else {
            const err = await res.json();
            alert(`Erreur de réindexation: ${err.error || 'Erreur inconnue'}`);
         }
      } catch (err) {
         console.error('Failed to reindex directories', err);
         alert('Erreur réseau lors de la réindexation');
      } finally {
         setReindexing(false);
      }
   };

   // Helper for category card colors
   const getCategoryCardClass = (cat?: string) => {
      switch (cat) {
         case 'work': return 'card-teal';
         case 'personal': return 'card-green';
         case 'urgent': return 'card-orange';
         default: return 'card-grey';
      }
   };

   const filteredDocs = documents.filter(doc => categoryFilter === 'all' || doc.category === categoryFilter);

   return (
       <div className="app-container">
          {/* Top Header */}
          <header style={{ padding: '24px', borderBottom: '1px solid rgba(255,255,255,0.08)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
             <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <div style={{ width: '42px', height: '42px', borderRadius: '10px', background: 'linear-gradient(135deg, var(--color-vivid-green), #06b6d4)', display: 'flex', alignItems: 'center', justifySelf: 'center', justifyContent: 'center', fontWeight: 900 }}>SB</div>
                <h1 style={{ fontSize: '24px', letterSpacing: '-0.5px' }}>Second Brain</h1>
             </div>
             {documents.length > 0 && (
                <div>
                   {uploading || addingUrl ? (
                      <IconLoader2 className="status-badge" style={{ animation: 'spin 1.5s linear infinite', color: 'var(--color-vivid-yellow)' }} />
                   ) : uploadSuccess ? (
                      <IconCircleCheck style={{ color: 'var(--color-vivid-green)' }} />
                   ) : null}
                </div>
             )}
          </header>

          {documents.length === 0 ? (
             /* Onboarding Screen */
             <main style={{ flex: 1, padding: '40px 24px', overflowY: 'auto', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', maxWidth: '600px', margin: '0 auto', gap: '24px' }}>
                <div style={{ textAlign: 'center', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                   <div style={{ width: '64px', height: '64px', borderRadius: '16px', background: 'linear-gradient(135deg, var(--color-vivid-green), #06b6d4)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto', fontSize: '28px', fontWeight: 900 }}>🧠</div>
                   <h2 style={{ fontSize: '28px', color: 'var(--color-vivid-green)', letterSpacing: '-0.5px', marginTop: '12px' }}>Bienvenue dans votre Second Brain</h2>
                   <p style={{ color: 'rgba(255,255,255,0.6)', fontSize: '15px', lineHeight: '1.5' }}>
                      Votre base de connaissances locale-first est prête. Sélectionnez vos passions et centres d'intérêt pour initialiser la première structure de dossiers :
                   </p>
                </div>

                <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                    {onboardingOptions.map(opt => {
                       const isExpanded = expandedInterests.includes(opt.key);
                       const selectedCount = (opt.subthemes || []).filter((sub: any) => selectedInterests.includes(sub.key)).length;
                       return (
                          <div 
                             key={opt.key}
                             style={{
                                padding: '16px',
                                borderRadius: '16px',
                                border: `1px solid ${selectedCount > 0 ? 'var(--color-vivid-green)' : 'rgba(255,255,255,0.06)'}`,
                                backgroundColor: 'rgba(255,255,255,0.02)',
                                transition: 'all 0.2s ease',
                                display: 'flex',
                                flexDirection: 'column',
                                gap: '12px'
                             }}
                          >
                             <div 
                                onClick={() => {
                                   setExpandedInterests(prev => isExpanded ? prev.filter(k => k !== opt.key) : [...prev, opt.key]);
                                }}
                                style={{
                                   cursor: 'pointer',
                                   display: 'flex',
                                   justifyContent: 'space-between',
                                   alignItems: 'center'
                                }}
                             >
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                   <span style={{ fontWeight: '600', color: selectedCount > 0 ? 'var(--color-vivid-green)' : 'white', display: 'flex', alignItems: 'center', gap: '8px' }}>
                                      {opt.label}
                                      {selectedCount > 0 && (
                                         <span style={{ fontSize: '11px', backgroundColor: 'rgba(0, 229, 153, 0.15)', color: 'var(--color-vivid-green)', padding: '2px 8px', borderRadius: '10px' }}>
                                            {selectedCount} sélectionné(s)
                                         </span>
                                      )}
                                   </span>
                                   <span style={{ fontSize: '12px', color: 'rgba(255,255,255,0.5)' }}>{opt.desc}</span>
                                </div>
                                <span style={{ color: 'rgba(255,255,255,0.4)', fontSize: '14px' }}>
                                   {isExpanded ? '▼' : '▶'}
                                </span>
                             </div>

                             {isExpanded && opt.subthemes && (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: '12px', paddingLeft: '8px' }}>
                                   {opt.subthemes.map((sub: any) => {
                                      const isSelected = selectedInterests.includes(sub.key);
                                      return (
                                         <div 
                                            key={sub.key}
                                            onClick={() => {
                                               setSelectedInterests(prev => isSelected ? prev.filter(k => k !== sub.key) : [...prev, sub.key]);
                                            }}
                                            style={{
                                               padding: '10px 12px',
                                               borderRadius: '10px',
                                               backgroundColor: isSelected ? 'rgba(0, 229, 153, 0.05)' : 'transparent',
                                               border: `1px solid ${isSelected ? 'var(--color-vivid-green)' : 'rgba(255,255,255,0.03)'}`,
                                               cursor: 'pointer',
                                               display: 'flex',
                                               alignItems: 'center',
                                               justifyContent: 'space-between',
                                               transition: 'all 0.15s ease'
                                            }}
                                         >
                                            <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                                               <span style={{ fontSize: '13px', fontWeight: '500', color: isSelected ? 'var(--color-vivid-green)' : 'white' }}>{sub.label}</span>
                                               <span style={{ fontSize: '11px', color: 'rgba(255,255,255,0.4)' }}>{sub.desc}</span>
                                            </div>
                                            <div style={{
                                               width: '18px',
                                               height: '18px',
                                               borderRadius: '4px',
                                               border: `1px solid ${isSelected ? 'var(--color-vivid-green)' : 'rgba(255,255,255,0.2)'}`,
                                               display: 'flex',
                                               alignItems: 'center',
                                               justifyContent: 'center',
                                               backgroundColor: isSelected ? 'var(--color-vivid-green)' : 'transparent'
                                            }}>
                                               {isSelected && <span style={{ color: '#090d16', fontSize: '11px', fontWeight: 'bold' }}>✓</span>}
                                            </div>
                                         </div>
                                      );
                                   })}
                                </div>
                             )}
                          </div>
                       );
                    })}
                 </div>

                <button 
                   onClick={handleInitializeOnboarding}
                   disabled={initializing || selectedInterests.length === 0}
                   className="action-button"
                   style={{ width: '100%', height: '52px', fontSize: '16px', fontWeight: 'bold', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}
                >
                   {initializing ? <IconLoader2 style={{ animation: 'spin 1s linear infinite' }} size={22} /> : 'Initialiser mon Second Brain'}
                </button>
             </main>
          ) : (
             /* Main Tabs Panel */
             <main style={{ flex: 1, padding: '20px', overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
            
            {/* VIEW 1: Chat Copilot */}
            {activeTab === 'chat' && (
               <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '16px' }}>
                  <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '16px', minHeight: '300px' }}>
                     {messages.map((msg, i) => (
                        <div 
                           key={i} 
                           className={msg.role === 'user' ? 'card-teal' : 'card-grey'}
                           style={{ 
                              alignSelf: msg.role === 'user' ? 'flex-end' : 'flex-start',
                              maxWidth: '85%',
                              borderBottomRightRadius: msg.role === 'user' ? '4px' : '20px',
                              borderBottomLeftRadius: msg.role === 'assistant' ? '4px' : '20px'
                           }}
                        >
                           <p style={{ fontSize: '16px', lineHeight: '1.5', whiteSpace: 'pre-wrap' }}>{msg.content}</p>
                        </div>
                     ))}
                     {sending && (
                        <div className="card-grey" style={{ alignSelf: 'flex-start', maxWidth: '80%', display: 'flex', alignItems: 'center', gap: '10px' }}>
                           <IconLoader2 style={{ animation: 'spin 1s linear infinite' }} size={20} />
                           <span className="secondary-meta">Copilot analyse vos documents...</span>
                        </div>
                     )}
                     <div ref={chatEndRef} />
                  </div>

                  {/* Chat input block (76px high) */}
                  <form onSubmit={handleSendMessage} style={{ display: 'flex', gap: '10px', marginTop: 'auto', position: 'sticky', bottom: '10px' }}>
                     <input 
                        type="text" 
                        className="action-input"
                        placeholder="Posez une question sur vos documents..."
                        value={inputMessage}
                        onChange={(e) => setInputMessage(e.target.value)}
                        disabled={sending}
                     />
                     <button type="submit" className="action-button" style={{ width: '76px' }} disabled={sending}>
                        <IconSend size={24} />
                     </button>
                  </form>
               </div>
            )}

            {/* VIEW 2: Documents List */}
            {activeTab === 'docs' && (
               <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                  {/* Category filters & Import button */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '16px', marginBottom: '8px' }}>
                     <h2 style={{ fontSize: '20px', fontWeight: '700', letterSpacing: '-0.5px' }}>Mes documents</h2>
                     <button 
                        onClick={() => setShowUploadModal(true)}
                        className="action-button"
                        style={{ height: '40px', padding: '0 16px', fontSize: '13px', borderRadius: '12px', display: 'flex', alignItems: 'center', gap: '8px' }}
                     >
                        <IconUpload size={16} /> Importer
                     </button>
                  </div>

                  {/* Import Queue Panel */}
                  {queueTasks.some(t => t.status === 'pending' || t.status === 'processing' || t.status === 'failed') && (
                     <div 
                        style={{ 
                           backgroundColor: 'rgba(255, 255, 255, 0.02)', 
                           padding: '16px', 
                           borderRadius: '16px', 
                           border: '1px solid rgba(255, 255, 255, 0.06)', 
                           display: 'flex', 
                           flexDirection: 'column', 
                           gap: '12px' 
                        }}
                     >
                        <h3 style={{ fontSize: '14px', fontWeight: '700', display: 'flex', alignItems: 'center', gap: '8px', margin: 0, color: 'var(--color-vivid-yellow)' }}>
                           <IconLoader2 size={16} style={{ animation: 'spin 1.5s linear infinite' }} />
                           File d'attente d'importation
                        </h3>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                           {queueTasks
                              .filter(t => t.status === 'pending' || t.status === 'processing' || t.status === 'failed')
                              .map(task => (
                                 <div 
                                    key={task.id} 
                                    style={{ 
                                       display: 'flex', 
                                       flexDirection: 'column', 
                                       gap: '6px', 
                                       padding: '12px', 
                                       borderRadius: '12px', 
                                       backgroundColor: 'rgba(255, 255, 255, 0.01)', 
                                       border: '1px solid rgba(255, 255, 255, 0.03)' 
                                    }}
                                 >
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                       <span style={{ fontSize: '13px', fontWeight: '500', maxWidth: '70%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                          {task.name}
                                       </span>
                                       <span 
                                          className={`status-badge ${task.status === 'processing' ? 'status-optimal' : task.status === 'failed' ? 'status-critical' : 'status-nominal'}`} 
                                          style={{ fontSize: '10px', padding: '2px 8px', textTransform: 'capitalize' }}
                                       >
                                          {task.status === 'processing' ? 'Analyse...' : task.status === 'failed' ? 'Échec' : 'En attente'}
                                       </span>
                                    </div>
                                    {task.status === 'processing' && (
                                       <div style={{ width: '100%', height: '4px', backgroundColor: 'rgba(255, 255, 255, 0.1)', borderRadius: '2px', overflow: 'hidden', marginTop: '2px' }}>
                                          <div style={{ width: `${task.progress}%`, height: '100%', backgroundColor: 'var(--color-vivid-green)', transition: 'width 0.3s ease' }} />
                                       </div>
                                    )}
                                    {task.status === 'failed' && task.error && (
                                       <span style={{ fontSize: '11px', color: '#ef4444', marginTop: '2px' }}>
                                          Erreur : {task.error}
                                       </span>
                                    )}
                                 </div>
                              ))}
                        </div>
                     </div>
                  )}

                  {/* Category filters */}
                  <div style={{ display: 'flex', gap: '8px', overflowX: 'auto', paddingBottom: '8px' }}>
                     {['all', ...Array.from(new Set(documents.map(d => d.category).filter(Boolean)))].map(cat => (
                        <button 
                           key={cat}
                           className={`status-badge ${categoryFilter === cat ? 'status-optimal' : 'status-nominal'}`}
                           onClick={() => setCategoryFilter(cat)}
                           style={{ border: 'none', cursor: 'pointer', padding: '8px 16px', fontSize: '13px', whiteSpace: 'nowrap' }}
                        >
                           {cat}
                        </button>
                     ))}
                  </div>

                  {selectedDoc ? (
                     /* Document detail overlay/card */
                     <div className={getCategoryCardClass(selectedDoc.category)} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                           <h2 style={{ fontSize: '20px' }}>{selectedDoc.title}</h2>
                           <button 
                              onClick={() => setSelectedDoc(null)} 
                              style={{ background: 'none', border: 'none', color: '#fff', fontSize: '16px', fontWeight: 900, cursor: 'pointer' }}
                           >
                              ✕
                           </button>
                        </div>
                        
                        <p style={{ fontSize: '15px', opacity: 0.9, lineHeight: '1.6' }}>{selectedDoc.summary}</p>
                        
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                           {selectedDoc.tags?.map((t, idx) => (
                              <span key={idx} className="status-badge status-nominal" style={{ fontSize: '11px', padding: '4px 10px' }}>
                                 <IconTag size={10} style={{ marginRight: '4px' }} />
                                 {t}
                              </span>
                           ))}
                        </div>

                        {selectedDoc.contextNote && (
                           <div style={{ backgroundColor: 'rgba(255,255,255,0.05)', padding: '12px', borderRadius: '12px', fontSize: '13px', borderLeft: '3px solid var(--color-vivid-green)', marginTop: '8px' }}>
                              <strong>Note de contexte :</strong> {selectedDoc.contextNote}
                           </div>
                        )}

                        {/* Move category actions */}
                        <div style={{ borderTop: '1px solid rgba(255,255,255,0.1)', paddingTop: '16px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                           <p className="secondary-meta" style={{ fontSize: '13px' }}>Classer le document :</p>
                           <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                              {['inbox', 'work', 'personal', 'urgent', ...Array.from(new Set(documents.map(d => d.category).filter(Boolean)))].filter((value, index, self) => self.indexOf(value) === index).map(cat => (
                                 <button 
                                    key={cat}
                                    onClick={() => handleUpdateCategory(selectedDoc, cat)}
                                    className={`status-badge ${selectedDoc.category === cat ? 'status-optimal' : 'status-nominal'}`}
                                    style={{ border: 'none', cursor: 'pointer', padding: '6px 12px', fontSize: '12px' }}
                                 >
                                    {cat}
                                 </button>
                              ))}
                           </div>
                           <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                              <input 
                                 type="text" 
                                 placeholder="Créer/Déplacer vers un dossier personnalisé (ex: literature/sci-fi)..."
                                 className="action-input"
                                 style={{ height: '36px', fontSize: '13px', padding: '0 12px', flex: 1 }}
                                 onKeyDown={(e) => {
                                    if (e.key === 'Enter') {
                                       e.preventDefault();
                                       const inputVal = (e.target as HTMLInputElement).value.trim();
                                       if (inputVal) {
                                          handleUpdateCategory(selectedDoc, inputVal);
                                          (e.target as HTMLInputElement).value = '';
                                       }
                                    }
                                 }}
                              />
                           </div>
                        </div>

                        <div style={{ display: 'flex', gap: '10px', marginTop: '10px' }}>
                           <button 
                              onClick={() => {
                                 setSelectedDoc(null);
                                 setMessages(prev => [
                                    ...prev,
                                    { role: 'user', content: `Parle-moi du document : "${selectedDoc.title}"` }
                                 ]);
                                 setActiveTab('chat');
                              }}
                              className="action-button"
                              style={{ flex: 1, height: '56px', fontSize: '15px' }}
                           >
                              <IconMessage size={18} />
                              Poser une question
                           </button>
                           <button 
                              onClick={() => handleDeleteDoc(selectedDoc.id)}
                              className="action-button btn-secondary"
                              style={{ width: '56px', height: '56px', padding: 0 }}
                           >
                              🗑
                           </button>
                        </div>

                        {selectedDoc.originalFileUri && (selectedDoc.originalFileUri.startsWith('http://') || selectedDoc.originalFileUri.startsWith('https://')) && (
                           <button 
                              onClick={() => {
                                 setSelectedDoc(null);
                                 setImportType('url');
                                 setUrlInput(selectedDoc.originalFileUri || '');
                                 setCrawlDepth(0);
                                 setShowUploadModal(true);
                              }}
                              className="action-button btn-secondary"
                              style={{ width: '100%', height: '48px', marginTop: '10px', fontSize: '13px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}
                           >
                              <IconRefresh size={16} /> Ré-explorer ce site web / Mettre à jour
                           </button>
                        )}
                     </div>
                  ) : null}

                  {/* Documents feed */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                     {filteredDocs.length === 0 ? (
                        <div className="card-grey" style={{ textAlign: 'center', padding: '40px' }}>
                           <p className="secondary-meta">Aucun document dans cette catégorie.</p>
                        </div>
                     ) : (
                        filteredDocs.map(doc => (
                           <div 
                              key={doc.id}
                              className={getCategoryCardClass(doc.category)}
                              onClick={() => setSelectedDoc(doc)}
                              style={{ cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: '10px', transition: 'transform 0.2s', position: 'relative' }}
                           >
                              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '12px' }}>
                                 <h3 style={{ fontSize: '18px', margin: 0, flex: 1 }}>{doc.title}</h3>
                                 <button 
                                    onClick={(e) => {
                                       e.stopPropagation();
                                       handleDeleteDoc(doc.id);
                                    }}
                                    style={{
                                       background: 'none',
                                       border: 'none',
                                       color: 'rgba(255, 255, 255, 0.4)',
                                       fontSize: '16px',
                                       cursor: 'pointer',
                                       padding: '4px 8px',
                                       borderRadius: '8px',
                                       transition: 'all 0.2s ease',
                                       display: 'flex',
                                       alignItems: 'center',
                                       justifyContent: 'center'
                                    }}
                                    onMouseOver={(e) => {
                                       e.currentTarget.style.color = '#ef4444';
                                       e.currentTarget.style.backgroundColor = 'rgba(239, 68, 68, 0.1)';
                                    }}
                                    onMouseOut={(e) => {
                                       e.currentTarget.style.color = 'rgba(255, 255, 255, 0.4)';
                                       e.currentTarget.style.backgroundColor = 'transparent';
                                    }}
                                 >
                                    🗑
                                 </button>
                              </div>
                              <p className="secondary-meta" style={{ fontSize: '14px', overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', margin: 0 }}>
                                 {doc.summary}
                              </p>
                              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '4px' }}>
                                 <span className="status-badge status-nominal" style={{ fontSize: '11px', padding: '4px 10px' }}>
                                    {doc.category}
                                 </span>
                                 <span className="secondary-meta" style={{ fontSize: '12px' }}>
                                    {doc.createdAt ? new Date(doc.createdAt).toLocaleDateString() : ''}
                                 </span>
                              </div>
                           </div>
                        ))
                     )}
                  </div>
               </div>
            )}

            {/* VIEW 3: Export & Stats */}
            {activeTab === 'stats' && (
               <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                  {/* Giant KPI metric display */}
                  <div className="card-teal" style={{ textAlign: 'center', padding: '30px' }}>
                     <p className="secondary-meta" style={{ fontSize: '16px', textTransform: 'uppercase', letterSpacing: '1px' }}>Total Documents</p>
                     <div className="giant-metric" style={{ margin: '16px 0' }}>{documents.length}</div>
                     <span className="secondary-meta">Indexés et prêts dans votre Second Brain</span>
                     {/* Category breakdown cards */}
                     <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', maxHeight: '200px', overflowY: 'auto', paddingRight: '4px' }}>
                        {Array.from(new Set(documents.map(d => d.category).filter(Boolean))).map((cat, idx) => {
                           const count = documents.filter(d => d.category === cat).length;
                           const cardClasses = ['card-grey', 'card-teal', 'card-green', 'card-orange'];
                           const cardClass = cardClasses[idx % cardClasses.length];
                           return (
                              <div key={cat} className={cardClass} style={{ padding: '16px' }}>
                                 <h4 className="secondary-meta" style={{ fontSize: '14px', color: cardClass !== 'card-grey' ? '#fff' : undefined }}>{cat}</h4>
                                 <div style={{ fontSize: '28px', fontWeight: 900, marginTop: '8px', color: cardClass !== 'card-grey' ? '#fff' : undefined }}>
                                    {count}
                                 </div>
                              </div>
                           );
                        })}
                     </div>
                  </div>

                  {/* CSV Export Action Button (76px high) */}
                  <a href="/api/export-csv" className="action-button" style={{ textDecoration: 'none', marginTop: '20px' }}>
                     <IconDownload size={24} />
                     Exporter la base en CSV
                  </a>

                  {/* Reindexing Action Button */}
                  <button 
                     onClick={handleReindex}
                     className="action-button btn-secondary"
                     disabled={reindexing}
                     style={{ 
                        marginTop: '10px',
                        height: '52px',
                        fontSize: '15px',
                        fontWeight: 'bold',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '8px'
                     }}
                  >
                     {reindexing ? (
                        <IconLoader2 style={{ animation: 'spin 1s linear infinite' }} size={22} />
                     ) : (
                        'Réindexer les dossiers (Regénérer les index.md)'
                     )}
                  </button>
               </div>
            )}

         {showUploadModal && (
            <div 
               style={{
                  position: 'fixed',
                  top: 0,
                  left: 0,
                  right: 0,
                  bottom: 0,
                  backgroundColor: 'rgba(9, 13, 22, 0.85)',
                  backdropFilter: 'blur(12px)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  zIndex: 1000,
                  padding: '20px',
                  boxSizing: 'border-box'
               }}
               onClick={(e) => {
                  if (e.target === e.currentTarget) {
                     setShowUploadModal(false);
                  }
               }}
            >
               <div 
                  style={{
                     backgroundColor: '#131924',
                     padding: '24px',
                     borderRadius: '24px',
                     border: '1px solid rgba(255,255,255,0.08)',
                     maxWidth: '500px',
                     width: '100%',
                     boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.7)',
                     display: 'flex',
                     flexDirection: 'column',
                     gap: '16px',
                     position: 'relative'
                  }}
               >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                     <h3 style={{ fontSize: '18px', fontWeight: 'bold' }}>Importer un document</h3>
                     <button 
                        onClick={() => setShowUploadModal(false)}
                        style={{ background: 'none', border: 'none', color: '#fff', fontSize: '18px', cursor: 'pointer', opacity: 0.6 }}
                     >
                        ✕
                     </button>
                  </div>

                  <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                     <button 
                        type="button"
                        onClick={() => { setImportType('pdf'); setSelectedFile(null); }}
                        className={`status-badge ${importType === 'pdf' ? 'status-optimal' : 'status-nominal'}`}
                        style={{ border: 'none', cursor: 'pointer', padding: '8px 12px', flex: '1 1 40%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px', fontSize: '13px' }}
                     >
                        <IconUpload size={16} /> PDF
                     </button>
                     <button 
                        type="button"
                        onClick={() => { setImportType('image'); setSelectedFile(null); }}
                        className={`status-badge ${importType === 'image' ? 'status-optimal' : 'status-nominal'}`}
                        style={{ border: 'none', cursor: 'pointer', padding: '8px 12px', flex: '1 1 40%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px', fontSize: '13px' }}
                     >
                        <IconCamera size={16} /> Image
                     </button>
                     <button 
                        type="button"
                        onClick={() => { setImportType('url'); setSelectedFile(null); }}
                        className={`status-badge ${importType === 'url' ? 'status-optimal' : 'status-nominal'}`}
                        style={{ border: 'none', cursor: 'pointer', padding: '8px 12px', flex: '1 1 40%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px', fontSize: '13px' }}
                     >
                        <IconDownload size={16} /> Lien Web
                     </button>
                     <button 
                        type="button"
                        onClick={() => { setImportType('text'); setSelectedFile(null); }}
                        className={`status-badge ${importType === 'text' ? 'status-optimal' : 'status-nominal'}`}
                        style={{ border: 'none', cursor: 'pointer', padding: '8px 12px', flex: '1 1 40%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px', fontSize: '13px' }}
                     >
                        <IconFileText size={16} /> Texte / MD
                     </button>
                  </div>

                  <form onSubmit={handleUnifiedImport} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                     {importType === 'pdf' ? (
                        <div>
                           <label style={{ display: 'flex', alignItems: 'center', justifySelf: 'center', justifyContent: 'center', height: '48px', border: '1px dashed rgba(255,255,255,0.15)', borderRadius: '12px', cursor: 'pointer', backgroundColor: 'rgba(255,255,255,0.01)', transition: 'border-color 0.2s', width: '100%' }}>
                              <span style={{ fontSize: '14px', color: selectedFile ? 'var(--color-vivid-green)' : 'rgba(255,255,255,0.5)', padding: '0 12px', textAlign: 'center', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                 {selectedFile ? `Fichier : ${selectedFile.name}` : 'Sélectionner un fichier PDF...'}
                              </span>
                              <input 
                                 type="file" 
                                 accept=".pdf" 
                                 onChange={(e) => setSelectedFile(e.target.files?.[0] || null)} 
                                 style={{ display: 'none' }} 
                              />
                           </label>
                        </div>
                     ) : importType === 'image' ? (
                        <div>
                           <label style={{ display: 'flex', alignItems: 'center', justifySelf: 'center', justifyContent: 'center', height: '48px', border: '1px dashed rgba(255,255,255,0.15)', borderRadius: '12px', cursor: 'pointer', backgroundColor: 'rgba(255,255,255,0.01)', transition: 'border-color 0.2s', width: '100%' }}>
                              <span style={{ fontSize: '14px', color: selectedFile ? 'var(--color-vivid-green)' : 'rgba(255,255,255,0.5)', padding: '0 12px', textAlign: 'center', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                 {selectedFile ? `Photo : ${selectedFile.name}` : 'Prendre une photo ou choisir une image...'}
                              </span>
                              <input 
                                 type="file" 
                                 accept="image/*" 
                                 onChange={(e) => setSelectedFile(e.target.files?.[0] || null)} 
                                 style={{ display: 'none' }} 
                              />
                           </label>
                        </div>
                     ) : importType === 'url' ? (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                            <input 
                               type="url" 
                               className="action-input"
                               placeholder="URL de la page web (ex: https://example.com/article)..."
                               value={urlInput}
                               onChange={(e) => setUrlInput(e.target.value)}
                               disabled={addingUrl}
                               required
                               style={{ width: '100%', boxSizing: 'border-box' }}
                            />
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                               <label style={{ fontSize: '12px', opacity: 0.6 }}>Profondeur de crawling :</label>
                               <select 
                                  className="action-input"
                                  value={crawlDepth}
                                  onChange={(e) => setCrawlDepth(parseInt(e.target.value))}
                                  style={{ width: '100%', boxSizing: 'border-box', backgroundColor: '#182030', color: '#fff', border: '1px solid rgba(255,255,255,0.08)' }}
                               >
                                  <option value={0}>Page principale uniquement (Profondeur 0)</option>
                                  <option value={1}>Page principale + Liens directs (Profondeur 1)</option>
                                  <option value={2}>Page principale + Liens directs + secondaires (Profondeur 2)</option>
                               </select>
                            </div>
                         </div>
                     ) : (
                        <textarea 
                           className="action-input"
                           placeholder="Collez ici votre texte brut ou Markdown provenant d'une autre conversation LLM..."
                           value={markdownInput}
                           onChange={(e) => setMarkdownInput(e.target.value)}
                           disabled={uploading}
                           required
                           rows={8}
                           style={{ minHeight: '150px', resize: 'vertical', width: '100%', boxSizing: 'border-box' }}
                        />
                     )}

                     <textarea 
                        className="action-input"
                        placeholder="Note de contexte (Optionnelle - ex: Pourquoi ce document est important, points clés à retenir...)"
                        value={contextNoteInput}
                        onChange={(e) => setContextNoteInput(e.target.value)}
                        disabled={uploading || addingUrl}
                        rows={3}
                        style={{ minHeight: '60px', resize: 'vertical', width: '100%', boxSizing: 'border-box' }}
                     />

                     <button 
                        type="submit" 
                        className="action-button" 
                        disabled={uploading || addingUrl || (importType === 'pdf' && !selectedFile) || (importType === 'image' && !selectedFile) || (importType === 'url' && !urlInput.trim()) || (importType === 'text' && !markdownInput.trim())}
                        style={{ height: '48px', fontWeight: '600', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}
                     >
                        {(uploading || addingUrl) ? (
                           <IconLoader2 style={{ animation: 'spin 1s linear infinite' }} size={20} />
                        ) : (
                           'Importer et analyser avec l\'IA'
                        )}
                     </button>
                  </form>
               </div>
            </div>
         )}

         </main>
      )}

          {/* Sticky Bottom Navigation (96px high) */}
          {documents.length > 0 && (
             <nav className="bottom-nav">
                <button 
                   className={`nav-item ${activeTab === 'chat' ? 'active' : ''}`}
                   onClick={() => setActiveTab('chat')}
                   style={{ background: 'none', border: 'none', cursor: 'pointer' }}
                >
                   <IconMessage size={28} />
                   <span style={{ marginTop: '4px' }}>Copilot</span>
                </button>
                <button 
                   className={`nav-item ${activeTab === 'docs' ? 'active' : ''}`}
                   onClick={() => setActiveTab('docs')}
                   style={{ background: 'none', border: 'none', cursor: 'pointer' }}
                >
                   <IconFileText size={28} />
                   <span style={{ marginTop: '4px' }}>Documents</span>
                </button>
                <button 
                   className={`nav-item ${activeTab === 'stats' ? 'active' : ''}`}
                   onClick={() => setActiveTab('stats')}
                   style={{ background: 'none', border: 'none', cursor: 'pointer' }}
                >
                   <IconFolder size={28} />
                   <span style={{ marginTop: '4px' }}>Stats & Export</span>
                </button>
             </nav>
          )}
          
          {/* Keyframe animation for spinner */}
          <style>{`
             @keyframes spin {
                0% { transform: rotate(0deg); }
                100% { transform: rotate(360deg); }
             }
          `}</style>
       </div>
    );
 }


