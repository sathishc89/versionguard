import { describe, expect, it } from 'vitest';
import { DocumentRecord, UserStats, VersionRecord } from '@versionguard/shared';
import { DocumentRepository, StatsRepository, VersionRepository } from '../src/repositories/interfaces.js';
import { StorageService } from '../src/services/s3.js';
import { ConflictError, NotFoundError, VersionGuardService } from '../src/services/version-guard.js';
import { sanitizeFilename, validatePresignInput } from '../src/utils/validation.js';

class FakeDocuments implements DocumentRepository {
  records = new Map<string, DocumentRecord>();
  async create(userId: string, name: string, description: string | undefined, now: string) { const document: DocumentRecord = { userId, entityKey: `DOC#${this.records.size + 1}`, documentId: `${this.records.size + 1}`, name, description, nextVersionNumber: 1, versionCount: 0, createdAt: now, updatedAt: now }; this.records.set(`${userId}:${document.documentId}`, document); return document; }
  async listByUser(userId: string) { return [...this.records.values()].filter((document) => document.userId === userId); }
  async getOwned(userId: string, documentId: string) { return this.records.get(`${userId}:${documentId}`); }
  async allocateVersion(userId: string, documentId: string, now: string) { const document = this.records.get(`${userId}:${documentId}`)!; const versionNumber = document.nextVersionNumber++; document.updatedAt = now; return { document, versionNumber }; }
  async recordCompletedVersion(userId: string, documentId: string, versionNumber: number, now: string) { const document = this.records.get(`${userId}:${documentId}`)!; document.versionCount += 1; document.latestVersionNumber = Math.max(document.latestVersionNumber ?? 0, versionNumber); document.updatedAt = now; }
}
class FakeVersions implements VersionRepository {
  records: VersionRecord[] = [];
  async createPending(version: VersionRecord) { this.records.push(version); }
  async getOwned(userId: string, documentId: string, versionNumber: number) { return this.records.find((version) => version.userId === userId && version.documentId === documentId && version.versionNumber === versionNumber); }
  async listOwned(userId: string, documentId: string) { return this.records.filter((version) => version.userId === userId && version.documentId === documentId); }
  async complete(version: VersionRecord, completedAt: string) { version.status = 'COMPLETE'; version.completedAt = completedAt; return version; }
  async findByHash(userId: string, documentId: string, sha256: string) { return this.records.find((version) => version.userId === userId && version.documentId === documentId && version.sha256 === sha256 && version.status === 'COMPLETE'); }
}
class FakeStats implements StatsRepository {
  values: UserStats = { userId: 'user-1', entityKey: 'STATS', staleWarnings: 0, forcedOlderShares: 0, totalShares: 0, latestShares: 0 };
  async get() { return this.values; }
  async increment(_userId: string, updates: Partial<Pick<UserStats, 'staleWarnings' | 'forcedOlderShares' | 'totalShares' | 'latestShares'>>) { this.values = { ...this.values, ...Object.fromEntries(Object.entries(updates).map(([key, value]) => [key, this.values[key as keyof UserStats] + value])) }; return this.values; }
}
class FakeStorage implements StorageService {
  async createUploadUrl() { return 'https://upload.example'; }
  async createDownloadUrl() { return 'https://download.example'; }
  async headObject() { return { size: 10 }; }
}

function setup() { const documents = new FakeDocuments(); const versions = new FakeVersions(); const stats = new FakeStats(); const service = new VersionGuardService({ documents, versions, stats, storage: new FakeStorage(), now: () => '2026-07-31T00:00:00.000Z' }); return { service, documents, versions, stats }; }
async function completedVersion(versions: FakeVersions, userId: string, documentId: string, number: number, status: VersionRecord['status'] = 'COMPLETE') { versions.records.push({ documentId, versionNumber: number, versionId: `${documentId}#${number}`, userId, originalFileName: `plan-${number}.docx`, safeFileName: `plan-${number}.docx`, s3Key: `users/${userId}/${number}`, contentType: 'application/octet-stream', size: 10, sha256: number.toString().padStart(64, '0'), status, uploadedAt: '2026-07-31T00:00:00.000Z', completedAt: status === 'COMPLETE' ? '2026-07-31T00:00:00.000Z' : undefined }); }

describe('VersionGuardService', () => {
  it('creates a document for the authenticated user', async () => { const { service } = setup(); const document = await service.createDocument('user-1', 'Project Plan', 'Planning'); expect(document.name).toBe('Project Plan'); expect(document.userId).toBe('user-1'); });
  it('allocates sequential version numbers', async () => { const { service, documents } = setup(); await service.createDocument('user-1', 'Plan'); expect((await documents.allocateVersion('user-1', '1', 'now')).versionNumber).toBe(1); expect((await documents.allocateVersion('user-1', '1', 'now')).versionNumber).toBe(2); });
  it('uses the highest completed version as latest and ignores pending versions', async () => { const { service, documents, versions } = setup(); await service.createDocument('user-1', 'Plan'); await completedVersion(versions, 'user-1', '1', 1); await completedVersion(versions, 'user-1', '1', 2, 'PENDING'); const result = await service.share('user-1', '1', 1, false); expect(result.warningShown).toBe(false); expect(versions.records[1].status).toBe('PENDING'); expect(documents.records.get('user-1:1')?.latestVersionNumber).toBeUndefined(); });
  it('shares latest without warning and updates latest stats', async () => { const { service, documents, versions, stats } = setup(); await service.createDocument('user-1', 'Plan'); await completedVersion(versions, 'user-1', 'missing', 1); await expect(service.share('user-1', 'missing', 1, false)).rejects.toBeInstanceOf(NotFoundError); await completedVersion(versions, 'user-1', '1', 1); const result = await service.share('user-1', '1', 1, false); expect(result.warningShown).toBe(false); expect(stats.values).toMatchObject({ totalShares: 1, latestShares: 1 }); expect(documents.records.has('user-1:1')).toBe(true); });
  it('returns STALE_VERSION for an older version', async () => { const { service, documents, versions, stats } = setup(); await service.createDocument('user-1', 'Plan'); await completedVersion(versions, 'user-1', '1', 1); await completedVersion(versions, 'user-1', '1', 2); await expect(service.share('user-1', '1', 1, false)).rejects.toMatchObject({ payload: { code: 'STALE_VERSION', selectedVersion: 1, latestVersion: 2 } }); expect(stats.values.staleWarnings).toBe(1); expect(documents.records.has('user-1:1')).toBe(true); });
  it('force-shares an older version and records it', async () => { const { service, documents, versions, stats } = setup(); await service.createDocument('user-1', 'Plan'); await completedVersion(versions, 'user-1', '1', 1); await completedVersion(versions, 'user-1', '1', 2); const result = await service.share('user-1', '1', 1, true, 'Approved exception'); expect(result.forcedOlderVersion).toBe(true); expect(stats.values.forcedOlderShares).toBe(1); expect(documents.records.has('user-1:1')).toBe(true); });
  it('denies access to another user document', async () => { const { service } = setup(); await service.createDocument('user-1', 'Private'); await expect(service.getDocument('user-2', '1')).rejects.toBeInstanceOf(NotFoundError); });
  it('detects duplicate complete content before presigning', async () => { const { service, versions } = setup(); await service.createDocument('user-1', 'Plan'); await completedVersion(versions, 'user-1', '1', 1); await expect(service.presignVersion('user-1', '1', { fileName: 'plan.docx', contentType: 'application/octet-stream', size: 10, sha256: `${'0'.repeat(63)}1` })).rejects.toBeInstanceOf(ConflictError); });
});

describe('upload validation', () => {
  it('rejects invalid filenames and sizes', () => { expect(() => sanitizeFilename('../plan.docx')).toThrow(); expect(() => validatePresignInput({ fileName: 'plan.docx', contentType: 'text/plain', size: 26 * 1024 * 1024, sha256: 'a'.repeat(64) })).toThrow(); });
  it('accepts and normalizes a safe filename', () => { expect(sanitizeFilename('  project plan.docx ')).toBe('project plan.docx'); });
});
