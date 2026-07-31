import { GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { PRESIGNED_DOWNLOAD_EXPIRY_SECONDS, PRESIGNED_UPLOAD_EXPIRY_SECONDS } from '@versionguard/shared';

export interface ObjectMetadata {
  size?: number;
  metadata?: Record<string, string>;
}

export interface StorageService {
  createUploadUrl(key: string, contentType: string, size: number, sha256: string): Promise<string>;
  createDownloadUrl(key: string, fileName: string): Promise<string>;
  headObject(key: string): Promise<ObjectMetadata>;
}

export class S3StorageService implements StorageService {
  constructor(private readonly client: S3Client, private readonly bucketName: string) {}

  async createUploadUrl(key: string, contentType: string, size: number, sha256: string): Promise<string> {
    const command = new PutObjectCommand({
      Bucket: this.bucketName,
      Key: key,
      ContentType: contentType,
      ContentLength: size,
      Metadata: { sha256 },
      ServerSideEncryption: 'AES256',
    });
    return getSignedUrl(this.client, command, { expiresIn: PRESIGNED_UPLOAD_EXPIRY_SECONDS });
  }

  async createDownloadUrl(key: string, fileName: string): Promise<string> {
    const command = new GetObjectCommand({
      Bucket: this.bucketName,
      Key: key,
      ResponseContentDisposition: `attachment; filename="${fileName.replace(/"/g, '')}"`,
    });
    return getSignedUrl(this.client, command, { expiresIn: PRESIGNED_DOWNLOAD_EXPIRY_SECONDS });
  }

  async headObject(key: string): Promise<ObjectMetadata> {
    const result = await this.client.send(new HeadObjectCommand({ Bucket: this.bucketName, Key: key }));
    return { size: result.ContentLength, metadata: result.Metadata };
  }
}

export function createS3Key(userId: string, documentId: string, versionNumber: number, safeFileName: string): string {
  return `users/${userId}/documents/${documentId}/versions/${versionNumber}/${safeFileName}`;
}
