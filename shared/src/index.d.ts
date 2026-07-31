export declare const MAX_UPLOAD_SIZE: number;
export declare const PRESIGNED_UPLOAD_EXPIRY_SECONDS = 900;
export declare const PRESIGNED_DOWNLOAD_EXPIRY_SECONDS = 900;
export type VersionStatus = 'PENDING' | 'COMPLETE';
export interface DocumentRecord {
    userId: string;
    entityKey: string;
    documentId: string;
    name: string;
    description?: string;
    latestVersionNumber?: number;
    nextVersionNumber: number;
    versionCount: number;
    createdAt: string;
    updatedAt: string;
}
export interface VersionRecord {
    documentId: string;
    versionNumber: number;
    versionId: string;
    userId: string;
    originalFileName: string;
    safeFileName: string;
    s3Key: string;
    contentType: string;
    size: number;
    sha256: string;
    note?: string;
    status: VersionStatus;
    uploadedAt: string;
    completedAt?: string;
}
export interface UserStats {
    userId: string;
    entityKey: 'STATS';
    staleWarnings: number;
    forcedOlderShares: number;
    totalShares: number;
    latestShares: number;
}
export interface CreateDocumentRequest {
    name: string;
    description?: string;
}
export interface PresignVersionRequest {
    fileName: string;
    contentType: string;
    size: number;
    sha256: string;
    note?: string;
}
export interface ShareRequest {
    force: boolean;
    reason?: string;
}
export interface MetricsResponse {
    totalDocuments: number;
    totalVersions: number;
    totalShares: number;
    staleWarnings: number;
    forcedOlderShares: number;
    latestSharePercentage: number;
}
export interface StaleVersionResponse {
    code: 'STALE_VERSION';
    message: string;
    selectedVersion: number;
    latestVersion: number;
    latestFileName: string;
}
