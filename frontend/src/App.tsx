import { ChangeEvent, ReactNode, useEffect, useMemo, useState } from 'react';
import { Sha256 } from '@aws-crypto/sha256-js';
import { DocumentRecord, MetricsResponse, VersionRecord } from '@versionguard/shared';
import { createApiClient, uploadWithProgress } from './api';
import { RuntimeConfig } from './types';

type Dialog = 'create' | 'upload' | 'history' | 'warning' | 'success' | null;
type ApiError = Error & { status?: number; code?: string; selectedVersion?: number; latestVersion?: number; latestFileName?: string };

const formatBytes = (bytes: number) => bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
const formatDate = (date: string) => new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(date));

async function sha256(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  if (crypto.subtle) {
    const digest = await crypto.subtle.digest('SHA-256', buffer);
    return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, '0')).join('');
  } else {
    const fallback = new Sha256();
    fallback.update(new Uint8Array(buffer));
    return Array.from(await fallback.digest()).map((byte) => byte.toString(16).padStart(2, '0')).join('');
  }
}

export default function App({ config, onSignOut }: { config: RuntimeConfig; onSignOut?: () => void }) {
  const api = useMemo(() => createApiClient(config), [config]);
  const [documents, setDocuments] = useState<DocumentRecord[]>([]);
  const [metrics, setMetrics] = useState<MetricsResponse | null>(null);
  const [versions, setVersions] = useState<VersionRecord[]>([]);
  const [selectedDocument, setSelectedDocument] = useState<DocumentRecord | null>(null);
  const [selectedVersion, setSelectedVersion] = useState<VersionRecord | null>(null);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');
  const [uploadProgress, setUploadProgress] = useState(0);
  const [shareLink, setShareLink] = useState('');
  const [shareVersion, setShareVersion] = useState<VersionRecord | null>(null);
  const [createName, setCreateName] = useState('');
  const [createDescription, setCreateDescription] = useState('');
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadNote, setUploadNote] = useState('');
  const [duplicateVersion, setDuplicateVersion] = useState<VersionRecord | null>(null);
  const [shareReason, setShareReason] = useState('');
  const [warningLatestVersion, setWarningLatestVersion] = useState<number | null>(null);
  const [warningLatestFileName, setWarningLatestFileName] = useState('');

  const refresh = async () => {
    setLoading(true); setError('');
    try { const [nextDocuments, nextMetrics] = await Promise.all([api<DocumentRecord[]>('/documents'), api<MetricsResponse>('/metrics')]); setDocuments(nextDocuments); setMetrics(nextMetrics); }
    catch (caught) { setError((caught as Error).message); }
    finally { setLoading(false); }
  };
  useEffect(() => { void refresh(); }, []);

  const filteredDocuments = documents.filter((document) => document.name.toLowerCase().includes(query.toLowerCase()));
  const openUpload = (document: DocumentRecord) => { setSelectedDocument(document); setUploadFile(null); setUploadNote(''); setDuplicateVersion(null); setUploadProgress(0); setDialog('upload'); };
  const openHistory = async (document: DocumentRecord) => { setSelectedDocument(document); setBusy(true); try { setVersions(await api<VersionRecord[]>(`/documents/${document.documentId}/versions`)); setDialog('history'); } catch (caught) { setToast((caught as Error).message); } finally { setBusy(false); } };
  const openShare = async (document: DocumentRecord, version: VersionRecord) => { setSelectedDocument(document); setSelectedVersion(version); setBusy(true); try { await share(document, version, false); } catch (caught) { const shareError = caught as ApiError; if (shareError.status === 409 && shareError.code === 'STALE_VERSION') { setWarningLatestVersion(shareError.latestVersion ?? null); setWarningLatestFileName(shareError.latestFileName ?? ''); setShareReason(''); setDialog('warning'); setToast('Version warning'); } else setToast(shareError.message); } finally { setBusy(false); } };
  const share = async (document: DocumentRecord, version: VersionRecord, force: boolean) => { const result = await api<{ shareUrl: string }>(`/documents/${document.documentId}/versions/${version.versionNumber}/share`, { method: 'POST', body: JSON.stringify({ force, reason: shareReason || undefined }) }); setShareLink(result.shareUrl); setShareVersion(version); setDialog('success'); await refresh(); };

  const createDocument = async () => { setBusy(true); try { await api('/documents', { method: 'POST', body: JSON.stringify({ name: createName, description: createDescription }) }); setCreateName(''); setCreateDescription(''); setDialog(null); setToast('Document created'); await refresh(); } catch (caught) { setToast((caught as Error).message); } finally { setBusy(false); } };
  const onFileChange = (event: ChangeEvent<HTMLInputElement>) => { const file = event.target.files?.[0] ?? null; setUploadFile(file); setDuplicateVersion(null); if (file && file.size > 25 * 1024 * 1024) setToast('Files must be 25 MB or smaller.'); };
  const upload = async () => {
    if (!selectedDocument || !uploadFile) return;
    setBusy(true); setUploadProgress(0);
    let uploadStage = 'preparing file';
    try {
      const hash = await sha256(uploadFile);
      uploadStage = 'checking existing versions';
      const existing = versions.find((version) => version.sha256 === hash) ?? (await api<VersionRecord[]>(`/documents/${selectedDocument.documentId}/versions`)).find((version) => version.sha256 === hash);
      if (existing) { setDuplicateVersion(existing); return; }
      uploadStage = 'requesting upload URL';
      const presign = await api<{ uploadUrl: string; versionNumber: number }>(`/documents/${selectedDocument.documentId}/versions/presign`, { method: 'POST', body: JSON.stringify({ fileName: uploadFile.name, contentType: uploadFile.type || 'application/octet-stream', size: uploadFile.size, sha256: hash, note: uploadNote }) });
      uploadStage = 'uploading file';
      await uploadWithProgress(presign.uploadUrl, uploadFile, setUploadProgress);
      uploadStage = 'confirming upload';
      await api(`/documents/${selectedDocument.documentId}/versions/${presign.versionNumber}/complete`, { method: 'POST' });
      setDialog(null); setToast('Upload successful'); await refresh();
    } catch (caught) { const error = caught as Error & { requestId?: string }; setToast(`Upload failed while ${uploadStage}: ${error.message}${error.requestId ? ` (trace ${error.requestId})` : ''}`); } finally { setBusy(false); }
  };
  const useLatest = async () => { if (!selectedDocument || !selectedVersion) return; setBusy(true); try { const list = await api<VersionRecord[]>(`/documents/${selectedDocument.documentId}/versions`); const latest = list.find((version) => version.status === 'COMPLETE'); if (latest) await share(selectedDocument, latest, false); } catch (caught) { setToast((caught as Error).message); } finally { setBusy(false); } };
  const download = async (version: VersionRecord) => { try { const result = await api<{ downloadUrl: string }>(`/documents/${version.documentId}/versions/${version.versionNumber}/download-url`); window.open(result.downloadUrl, '_blank', 'noopener,noreferrer'); } catch (caught) { setToast(`Download failure: ${(caught as Error).message}`); } };
  const closeDialog = () => { if (!busy) setDialog(null); };

  return <main className="app-shell">
    <header className="topbar"><div className="brand"><span className="brand-mark">VG</span><div><strong>VersionGuard</strong><small>Share the right version</small></div></div><div className="header-actions"><span className="status-dot">Protected workspace</span>{onSignOut && <button className="ghost-button" onClick={onSignOut}>Sign out</button>}</div></header>
    <section className="hero"><div><p className="eyebrow">DOCUMENT CONTROL</p><h1>Make outdated shares<br /><em>impossible to miss.</em></h1><p className="hero-copy">VersionGuard watches the version you are about to share and pauses you when a newer file is ready.</p></div><button className="primary-button" onClick={() => setDialog('create')}>+ Create document</button></section>
    <section className="metrics" aria-label="Workspace metrics"><Metric label="Documents" value={metrics?.totalDocuments ?? 0} accent="blue" /><Metric label="Completed versions" value={metrics?.totalVersions ?? 0} accent="green" /><Metric label="Stale warnings" value={metrics?.staleWarnings ?? 0} accent="amber" /><Metric label="Older shares" value={metrics?.forcedOlderShares ?? 0} accent="red" /><div className="metric metric-wide"><span>Latest-version share rate</span><strong>{metrics?.latestSharePercentage ?? 0}%</strong><div className="meter"><i style={{ width: `${metrics?.latestSharePercentage ?? 0}%` }} /></div></div></section>
    <section className="content"><div className="section-heading"><div><p className="eyebrow">YOUR LIBRARY</p><h2>Documents</h2></div><label className="search"><span>⌕</span><input aria-label="Search documents" placeholder="Search documents" value={query} onChange={(event) => setQuery(event.target.value)} /></label></div>
      {loading ? <div className="state-panel"><span className="spinner" />Loading your documents...</div> : error ? <div className="state-panel error-state"><strong>Unable to load workspace</strong><span>{error}</span><button className="secondary-button" onClick={() => void refresh()}>Try again</button></div> : filteredDocuments.length === 0 ? <div className="empty-state"><div className="empty-icon">+</div><h3>{query ? 'No matching documents' : 'Your library is ready'}</h3><p>{query ? 'Try a different search term.' : 'Create a document group, then add its first version.'}</p>{!query && <button className="primary-button" onClick={() => setDialog('create')}>Create your first document</button>}</div> : <div className="document-list">{filteredDocuments.map((document) => <article className="document-row" key={document.documentId}><div className="file-icon">DOC</div><div className="document-info"><h3>{document.name}</h3><p>{document.description || 'No description'} · Updated {formatDate(document.updatedAt)}</p></div><div className="document-stat"><span>Latest</span><strong>{document.latestVersionNumber ? `v${document.latestVersionNumber}` : 'None'}</strong></div><div className="document-stat"><span>Versions</span><strong>{document.versionCount}</strong></div><div className="row-actions"><button className="secondary-button" onClick={() => openUpload(document)}>Upload version</button><button className="ghost-button" onClick={() => void openHistory(document)}>History</button><button className="share-button" disabled={!document.latestVersionNumber || busy} onClick={async () => { const list = await api<VersionRecord[]>(`/documents/${document.documentId}/versions`); const latest = list.find((version) => version.versionNumber === document.latestVersionNumber); if (latest) await openShare(document, latest); }}>Share latest</button></div></article>)}</div>}
    </section>
    {dialog === 'create' && <Dialog title="Create document" onClose={closeDialog}><p className="dialog-intro">Create a space for related file versions.</p><label>Document name<input autoFocus value={createName} onChange={(event) => setCreateName(event.target.value)} placeholder="e.g. Project Plan" /></label><label>Description <span>(optional)</span><textarea value={createDescription} onChange={(event) => setCreateDescription(event.target.value)} placeholder="What is this document for?" /></label><DialogActions onCancel={closeDialog} onConfirm={() => void createDocument()} confirmLabel="Create document" busy={busy} /></Dialog>}
    {dialog === 'upload' && <Dialog title={`Upload to ${selectedDocument?.name ?? ''}`} onClose={closeDialog}><p className="dialog-intro">A new version gets a number only after its upload is complete.</p><label className="file-drop"><input type="file" onChange={onFileChange} />{uploadFile ? <><strong>{uploadFile.name}</strong><span>{formatBytes(uploadFile.size)}</span></> : <><strong>Choose a file</strong><span>Up to 25 MB</span></>}</label><label>Version note <span>(optional)</span><textarea value={uploadNote} onChange={(event) => setUploadNote(event.target.value)} placeholder="What changed?" /></label>{duplicateVersion && <div className="inline-warning">This content matches Version {duplicateVersion.versionNumber}. Choose a changed file to create a new version.</div>}{busy && <div className="progress-wrap"><div className="progress-label"><span>Uploading</span><strong>{uploadProgress}%</strong></div><div className="progress"><i style={{ width: `${uploadProgress}%` }} /></div></div>}<DialogActions onCancel={closeDialog} onConfirm={() => void upload()} confirmLabel="Upload version" busy={busy || !uploadFile} /></Dialog>}
    {dialog === 'history' && <Dialog title="Version history" onClose={closeDialog} wide><p className="dialog-intro">{selectedDocument?.name} · newest first</p><div className="history-table"><div className="history-head"><span>Version</span><span>File</span><span>Uploaded</span><span>Status</span><span /></div>{versions.map((version) => <div className="history-row" key={version.versionId}><strong>v{version.versionNumber}{version.versionNumber === selectedDocument?.latestVersionNumber && <b className="latest-badge">Latest</b>}</strong><span title={version.originalFileName}>{version.originalFileName}</span><span>{formatDate(version.completedAt ?? version.uploadedAt)}</span><span className={version.status === 'COMPLETE' ? 'complete' : 'pending'}>{version.status}</span><span className="history-actions"><button className="ghost-button" disabled={version.status !== 'COMPLETE'} onClick={() => void download(version)}>Download</button><button className="share-button" disabled={version.status !== 'COMPLETE' || busy} onClick={() => selectedDocument && void openShare(selectedDocument, version)}>Share</button></span></div>)}</div></Dialog>}
    {dialog === 'warning' && <Dialog title="Hold on: newer version found" onClose={closeDialog} warning><div className="warning-box"><span className="warning-symbol">!</span><p>You are sharing <strong>Version {selectedVersion?.versionNumber}</strong>, but <strong>Version {warningLatestVersion ?? '?'} is the latest available version.</strong>{warningLatestFileName && <><br /><small>{warningLatestFileName}</small></>}</p></div><label>Reason for sharing this version <span>(optional)</span><textarea value={shareReason} onChange={(event) => setShareReason(event.target.value)} placeholder="e.g. This version was approved by legal" /></label><div className="dialog-actions stacked"><button className="primary-button" onClick={() => void useLatest()} disabled={busy}>Use latest version</button><button className="warning-button" onClick={async () => { if (selectedDocument && selectedVersion) { setBusy(true); try { await share(selectedDocument, selectedVersion, true); } catch (caught) { setToast((caught as Error).message); } finally { setBusy(false); } } }} disabled={busy}>Share this version anyway</button><button className="ghost-button" onClick={closeDialog}>Cancel</button></div></Dialog>}
    {dialog === 'success' && <Dialog title="Share link ready" onClose={closeDialog}><div className="success-mark">✓</div><p className="success-copy">{shareVersion?.originalFileName} · Version {shareVersion?.versionNumber}</p><label>Share link<div className="copy-field"><input readOnly value={shareLink} /><button className="secondary-button" onClick={() => { void navigator.clipboard.writeText(shareLink); setToast('Link copied'); }}>Copy</button></div></label><p className="expiration">This link expires in 15 minutes.</p><DialogActions onCancel={closeDialog} onConfirm={closeDialog} confirmLabel="Done" /></Dialog>}
    {toast && <button className="toast" onClick={() => setToast('')}>{toast}<span>×</span></button>}
  </main>;
}

function Metric({ label, value, accent }: { label: string; value: number; accent: string }) { return <div className={`metric metric-${accent}`}><span>{label}</span><strong>{value}</strong></div>; }
function Dialog({ title, children, onClose, wide, warning }: { title: string; children: ReactNode; onClose: () => void; wide?: boolean; warning?: boolean }) { return <div className="modal-backdrop" role="presentation"><section className={`dialog ${wide ? 'dialog-wide' : ''} ${warning ? 'dialog-warning' : ''}`} role="dialog" aria-modal="true" aria-labelledby="dialog-title"><button className="close-button" aria-label="Close dialog" onClick={onClose}>×</button><h2 id="dialog-title">{title}</h2>{children}</section></div>; }
function DialogActions({ onCancel, onConfirm, confirmLabel, busy }: { onCancel: () => void; onConfirm: () => void; confirmLabel: string; busy?: boolean }) { return <div className="dialog-actions"><button className="ghost-button" onClick={onCancel}>Cancel</button><button className="primary-button" onClick={onConfirm} disabled={busy}>{busy ? 'Working...' : confirmLabel}</button></div>; }
