import { DocumentRecord, MetricsResponse, PresignVersionRequest, StaleVersionResponse, UserStats, VersionRecord } from '@versionguard/shared';
import { DocumentRepository, StatsRepository, VersionRepository } from '../repositories/interfaces.js';
import { createS3Key, StorageService } from './s3.js';
import { sanitizeFilename, validatePresignInput } from '../utils/validation.js';

export class NotFoundError extends Error {
  public readonly statusCode = 404;
}

export class ConflictError extends Error {
  public readonly statusCode = 409;
  constructor(public readonly payload: StaleVersionResponse) {
    super(payload.message);
  }
}

export class ForbiddenError extends Error {
  public readonly statusCode = 403;
}

export interface VersionGuardDependencies {
  documents: DocumentRepository;
  versions: VersionRepository;
  stats: StatsRepository;
  storage: StorageService;
  now?: () => string;
}

export class VersionGuardService {
  private readonly now: () => string;

  constructor(private readonly dependencies: VersionGuardDependencies) {
    this.now = dependencies.now ?? (() => new Date().toISOString());
  }

  createDocument(userId: string, name: string, description?: string): Promise<DocumentRecord> {
    return this.dependencies.documents.create(userId, name, description, this.now());
  }

  listDocuments(userId: string): Promise<DocumentRecord[]> {
    return this.dependencies.documents.listByUser(userId);
  }

  async getDocument(userId: string, documentId: string): Promise<DocumentRecord> {
    const document = await this.dependencies.documents.getOwned(userId, documentId);
    if (!document) throw new NotFoundError('Document not found.');
    return document;
  }

  async listVersions(userId: string, documentId: string): Promise<VersionRecord[]> {
    await this.getDocument(userId, documentId);
    return (await this.dependencies.versions.listOwned(userId, documentId)).sort((a, b) => b.versionNumber - a.versionNumber);
  }

  async presignVersion(userId: string, documentId: string, input: Partial<PresignVersionRequest>) {
    const document = await this.getDocument(userId, documentId);
    const request = validatePresignInput(input);
    const duplicate = await this.dependencies.versions.findByHash(userId, documentId, request.sha256);
    if (duplicate) {
      throw new ConflictError({ code: 'STALE_VERSION', message: `This content already exists as Version ${duplicate.versionNumber}.`, selectedVersion: duplicate.versionNumber, latestVersion: document.latestVersionNumber ?? 0, latestFileName: duplicate.originalFileName });
    }
    const allocation = await this.dependencies.documents.allocateVersion(userId, documentId, this.now());
    const version: VersionRecord = {
      documentId,
      versionNumber: allocation.versionNumber,
      versionId: `${documentId}#${allocation.versionNumber}`,
      userId,
      originalFileName: request.fileName,
      safeFileName: sanitizeFilename(request.fileName),
      s3Key: createS3Key(userId, documentId, allocation.versionNumber, request.fileName),
      contentType: request.contentType,
      size: request.size,
      sha256: request.sha256,
      note: request.note,
      status: 'PENDING',
      uploadedAt: this.now(),
    };
    await this.dependencies.versions.createPending(version);
    return { documentId, versionNumber: version.versionNumber, uploadUrl: await this.dependencies.storage.createUploadUrl(version.s3Key, version.contentType, version.size, version.sha256), expiresIn: 900 };
  }

  async completeVersion(userId: string, documentId: string, versionNumber: number): Promise<VersionRecord> {
    await this.getDocument(userId, documentId);
    const version = await this.dependencies.versions.getOwned(userId, documentId, versionNumber);
    if (!version) throw new NotFoundError('Version not found.');
    if (version.status === 'COMPLETE') return version;
    const object = await this.dependencies.storage.headObject(version.s3Key);
    if (object.size !== version.size) throw new ConflictError({ code: 'STALE_VERSION', message: 'Uploaded file size does not match the requested size.', selectedVersion: versionNumber, latestVersion: 0, latestFileName: version.originalFileName });
    const completed = await this.dependencies.versions.complete(version, this.now());
    await this.dependencies.documents.recordCompletedVersion(userId, documentId, versionNumber, this.now());
    return completed;
  }

  async createDownloadUrl(userId: string, documentId: string, versionNumber: number) {
    const version = await this.getOwnedVersion(userId, documentId, versionNumber);
    return { downloadUrl: await this.dependencies.storage.createDownloadUrl(version.s3Key, version.safeFileName), expiresIn: 900 };
  }

  async share(userId: string, documentId: string, versionNumber: number, force: boolean, reason?: string) {
    const version = await this.getOwnedVersion(userId, documentId, versionNumber);
    const versions = await this.dependencies.versions.listOwned(userId, documentId);
    const completed = versions.filter((candidate) => candidate.status === 'COMPLETE');
    const latest = completed.reduce<VersionRecord | undefined>((current, candidate) => !current || candidate.versionNumber > current.versionNumber ? candidate : current, undefined);
    if (!latest) throw new NotFoundError('There is no completed version to share.');
    const isOlder = version.versionNumber < latest.versionNumber;
    if (isOlder && !force) {
      const warning: StaleVersionResponse = { code: 'STALE_VERSION', message: 'You are attempting to share an older version.', selectedVersion: versionNumber, latestVersion: latest.versionNumber, latestFileName: latest.originalFileName };
      await this.dependencies.stats.increment(userId, { staleWarnings: 1 });
      throw new ConflictError(warning);
    }
    const stats = await this.dependencies.stats.increment(userId, { totalShares: 1, latestShares: isOlder ? 0 : 1, forcedOlderShares: isOlder && force ? 1 : 0 });
    void reason;
    return { shareUrl: await this.dependencies.storage.createDownloadUrl(version.s3Key, version.safeFileName), expiresIn: 900, warningShown: isOlder, forcedOlderVersion: isOlder && force, latestSharePercentage: stats.totalShares ? Math.round((stats.latestShares / stats.totalShares) * 100) : 0 };
  }

  async metrics(userId: string): Promise<MetricsResponse> {
    const documents = await this.dependencies.documents.listByUser(userId);
    const versions = (await Promise.all(documents.map((document) => this.dependencies.versions.listOwned(userId, document.documentId)))).flat();
    const stats: UserStats = await this.dependencies.stats.get(userId);
    return { totalDocuments: documents.length, totalVersions: versions.filter((version) => version.status === 'COMPLETE').length, totalShares: stats.totalShares, staleWarnings: stats.staleWarnings, forcedOlderShares: stats.forcedOlderShares, latestSharePercentage: stats.totalShares ? Math.round((stats.latestShares / stats.totalShares) * 100) : 0 };
  }

  private async getOwnedVersion(userId: string, documentId: string, versionNumber: number): Promise<VersionRecord> {
    await this.getDocument(userId, documentId);
    const version = await this.dependencies.versions.getOwned(userId, documentId, versionNumber);
    if (!version) throw new NotFoundError('Version not found.');
    if (version.status !== 'COMPLETE') throw new ConflictError({ code: 'STALE_VERSION', message: 'This version is not complete.', selectedVersion: versionNumber, latestVersion: 0, latestFileName: version.originalFileName });
    return version;
  }
}
