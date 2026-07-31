import { DocumentRecord, UserStats, VersionRecord } from '@versionguard/shared';

export interface DocumentRepository {
  create(userId: string, name: string, description: string | undefined, now: string): Promise<DocumentRecord>;
  listByUser(userId: string): Promise<DocumentRecord[]>;
  getOwned(userId: string, documentId: string): Promise<DocumentRecord | undefined>;
  allocateVersion(userId: string, documentId: string, now: string): Promise<{ document: DocumentRecord; versionNumber: number }>;
  recordCompletedVersion(userId: string, documentId: string, versionNumber: number, now: string): Promise<void>;
}

export interface VersionRepository {
  createPending(version: VersionRecord): Promise<void>;
  getOwned(userId: string, documentId: string, versionNumber: number): Promise<VersionRecord | undefined>;
  listOwned(userId: string, documentId: string): Promise<VersionRecord[]>;
  complete(version: VersionRecord, completedAt: string): Promise<VersionRecord>;
  findByHash(userId: string, documentId: string, sha256: string): Promise<VersionRecord | undefined>;
}

export interface StatsRepository {
  get(userId: string): Promise<UserStats>;
  increment(userId: string, updates: Partial<Pick<UserStats, 'staleWarnings' | 'forcedOlderShares' | 'totalShares' | 'latestShares'>>): Promise<UserStats>;
}
