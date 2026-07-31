import { MAX_UPLOAD_SIZE, PresignVersionRequest } from '@versionguard/shared';

const SAFE_FILENAME = /^[^\\/:*?"<>|\u0000-\u001f]+$/;
const SHA256 = /^[a-fA-F0-9]{64}$/;

export class RequestValidationError extends Error {
  public readonly statusCode = 400;

  constructor(message: string) {
    super(message);
    this.name = 'RequestValidationError';
  }
}

export function validateDocumentInput(name: unknown, description: unknown): { name: string; description?: string } {
  if (typeof name !== 'string' || name.trim().length < 1 || name.trim().length > 120) {
    throw new RequestValidationError('Document name must be between 1 and 120 characters.');
  }
  if (description !== undefined && (typeof description !== 'string' || description.length > 500)) {
    throw new RequestValidationError('Description must be at most 500 characters.');
  }
  return { name: name.trim(), description: typeof description === 'string' && description.trim() ? description.trim() : undefined };
}

export function sanitizeFilename(fileName: unknown): string {
  if (typeof fileName !== 'string' || !fileName.trim() || fileName.length > 180 || !SAFE_FILENAME.test(fileName)) {
    throw new RequestValidationError('Filename is invalid.');
  }
  const normalized = fileName.trim().replace(/\s+/g, ' ');
  if (normalized === '.' || normalized === '..' || normalized.includes('..')) {
    throw new RequestValidationError('Filename is invalid.');
  }
  return normalized;
}

export function validatePresignInput(input: Partial<PresignVersionRequest>): PresignVersionRequest {
  const fileName = sanitizeFilename(input.fileName);
  const size = input.size;
  if (typeof input.contentType !== 'string' || !/^[\w.-]+\/[\w.+-]+$/.test(input.contentType)) {
    throw new RequestValidationError('Content type is invalid.');
  }
  if (!Number.isSafeInteger(size) || size === undefined || size <= 0 || size > MAX_UPLOAD_SIZE) {
    throw new RequestValidationError('File size must be between 1 byte and 25 MB.');
  }
  if (typeof input.sha256 !== 'string' || !SHA256.test(input.sha256)) {
    throw new RequestValidationError('SHA-256 must be a 64-character hexadecimal value.');
  }
  if (input.note !== undefined && (typeof input.note !== 'string' || input.note.length > 500)) {
    throw new RequestValidationError('Version note must be at most 500 characters.');
  }
  return {
    fileName,
    contentType: input.contentType,
    size,
    sha256: input.sha256.toLowerCase(),
    note: typeof input.note === 'string' && input.note.trim() ? input.note.trim() : undefined,
  };
}
