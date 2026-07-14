import React, { useState, useEffect, useRef } from 'react';
import { 
   IconMessage, 
   IconFileText, 
   IconDownload, 
   IconUpload, 
   IconSend, 
   IconFolder, 
   IconTag,
   IconLoader2,
   IconCircleCheck
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
   
   // Chat state
   const [messages, setMessages] = useState<Message[]>([
      { role: 'assistant', content: 'Bonjour ! Je suis votre Second Brain Copilot. Vous pouvez uploader des PDFs dans l\'onglet "Documents" pour que je puisse les synthétiser et y accéder, ou simplement me poser des questions.' }
   ]);
   const [inputMessage, setInputMessage] = useState('');
   const [sending, setSending] = useState(false);
   const chatEndRef = useRef<HTMLDivElement>(null);

   useEffect(() => {
      fetchDocuments();
   }, []);

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
            setDocuments(data.items || []);
         }
      } catch (err) {
         console.error('Failed to fetch documents', err);
      }
   };

   // Upload PDF
   const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;

      setUploading(true);
      setUploadSuccess(false);

      const formData = new FormData();
      formData.append('file', file);
      formData.append('category', 'inbox');

      try {
         const res = await fetch('/api/upload', {
            method: 'POST',
            body: formData
         });
         if (res.ok) {
            const data = await res.json();
            setUploadSuccess(true);
            // Append to document list
            setDocuments(prev => [data.item, ...prev]);
            // Add automated assistant chat message
            setMessages(prev => [
               ...prev,
               { role: 'assistant', content: `Nouveau document analysé : "${data.item.title}". J'ai extrait un résumé et les tags. Vous pouvez maintenant me poser des questions à son sujet !` }
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
         if (e.target) e.target.value = '';
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
            {uploading ? (
               <IconLoader2 className="status-badge" style={{ animation: 'spin 1.5s linear infinite', color: 'var(--color-vivid-yellow)' }} />
            ) : uploadSuccess ? (
               <IconCircleCheck style={{ color: 'var(--color-vivid-green)' }} />
            ) : (
               <label className="status-badge status-optimal" style={{ cursor: 'pointer', padding: '10px', borderRadius: '12px' }}>
                  <IconUpload size={20} />
                  <input type="file" accept=".pdf" onChange={handleFileUpload} style={{ display: 'none' }} />
               </label>
            )}
         </header>

         {/* Main Tabs Panel */}
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
                  {/* Category filters */}
                  <div style={{ display: 'flex', gap: '8px', overflowX: 'auto', paddingBottom: '8px' }}>
                     {['all', 'inbox', 'work', 'personal', 'urgent'].map(cat => (
                        <button 
                           key={cat}
                           className={`status-badge ${categoryFilter === cat ? 'status-optimal' : 'status-nominal'}`}
                           onClick={() => setCategoryFilter(cat)}
                           style={{ border: 'none', cursor: 'pointer', padding: '8px 16px', fontSize: '13px' }}
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

                        {/* Move category actions */}
                        <div style={{ borderTop: '1px solid rgba(255,255,255,0.1)', paddingTop: '16px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                           <p className="secondary-meta" style={{ fontSize: '13px' }}>Classer le document :</p>
                           <div style={{ display: 'flex', gap: '6px' }}>
                              {['inbox', 'work', 'personal', 'urgent'].map(cat => (
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
                              style={{ cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: '10px', transition: 'transform 0.2s' }}
                           >
                              <h3 style={{ fontSize: '18px' }}>{doc.title}</h3>
                              <p className="secondary-meta" style={{ fontSize: '14px', overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
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
                  </div>

                  {/* Category breakdown cards */}
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                     <div className="card-grey" style={{ padding: '16px' }}>
                        <h4 className="secondary-meta" style={{ fontSize: '14px' }}>Inbox</h4>
                        <div style={{ fontSize: '28px', fontWeight: 900, marginTop: '8px' }}>
                           {documents.filter(d => d.category === 'inbox' || !d.category).length}
                        </div>
                     </div>
                     <div className="card-teal" style={{ padding: '16px' }}>
                        <h4 className="secondary-meta" style={{ fontSize: '14px', color: '#fff' }}>Work</h4>
                        <div style={{ fontSize: '28px', fontWeight: 900, marginTop: '8px', color: '#fff' }}>
                           {documents.filter(d => d.category === 'work').length}
                        </div>
                     </div>
                     <div className="card-green" style={{ padding: '16px' }}>
                        <h4 className="secondary-meta" style={{ fontSize: '14px', color: '#fff' }}>Personal</h4>
                        <div style={{ fontSize: '28px', fontWeight: 900, marginTop: '8px', color: '#fff' }}>
                           {documents.filter(d => d.category === 'personal').length}
                        </div>
                     </div>
                     <div className="card-orange" style={{ padding: '16px' }}>
                        <h4 className="secondary-meta" style={{ fontSize: '14px', color: '#fff' }}>Urgent</h4>
                        <div style={{ fontSize: '28px', fontWeight: 900, marginTop: '8px', color: '#fff' }}>
                           {documents.filter(d => d.category === 'urgent').length}
                        </div>
                     </div>
                  </div>

                  {/* CSV Export Action Button (76px high) */}
                  <a href="/api/export-csv" className="action-button" style={{ textDecoration: 'none', marginTop: '20px' }}>
                     <IconDownload size={24} />
                     Exporter la base en CSV
                  </a>
               </div>
            )}

         </main>

         {/* Sticky Bottom Navigation (96px high) */}
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
