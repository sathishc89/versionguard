import { APIGatewayProxyEventV2WithJWTAuthorizer, APIGatewayProxyResultV2 } from 'aws-lambda';
import { S3Client } from '@aws-sdk/client-s3';
import { createDynamoDocumentClient, DynamoDocumentRepository, DynamoStatsRepository, DynamoVersionRepository } from '../repositories/dynamodb.js';
import { VersionGuardService, ConflictError, ForbiddenError, NotFoundError } from '../services/version-guard.js';
import { getUserId, UnauthorizedError } from '../utils/auth.js';
import { RequestValidationError, validateDocumentInput } from '../utils/validation.js';
import { S3StorageService } from '../services/s3.js';

const dynamo = createDynamoDocumentClient();
const service = new VersionGuardService({
  documents: new DynamoDocumentRepository(dynamo, process.env.DOCUMENTS_TABLE ?? ''),
  versions: new DynamoVersionRepository(dynamo, process.env.VERSIONS_TABLE ?? ''),
  stats: new DynamoStatsRepository(dynamo, process.env.DOCUMENTS_TABLE ?? ''),
  storage: new S3StorageService(new S3Client({}), process.env.UPLOADS_BUCKET ?? ''),
});

function response(statusCode: number, body: unknown): APIGatewayProxyResultV2 {
  return { statusCode, headers: { 'content-type': 'application/json', 'access-control-allow-origin': process.env.FRONTEND_ORIGIN ?? '*', 'access-control-allow-headers': 'authorization,content-type', 'access-control-allow-methods': 'GET,POST,PUT,PATCH,DELETE,HEAD,OPTIONS' }, body: JSON.stringify(body) };
}

function parseBody(event: APIGatewayProxyEventV2WithJWTAuthorizer): Record<string, unknown> {
  if (!event.body) return {};
  try { return JSON.parse(event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString('utf8') : event.body) as Record<string, unknown>; } catch { throw new RequestValidationError('Request body must be valid JSON.'); }
}

export async function handler(event: APIGatewayProxyEventV2WithJWTAuthorizer): Promise<APIGatewayProxyResultV2> {
  if (event.rawPath === '/health') return response(200, { status: 'ok' });
  if (event.requestContext.http.method === 'OPTIONS') return response(204, {});
  try {
    const userId = getUserId(event);
    const method = event.requestContext.http.method;
    const path = event.rawPath;
    const pathParts = path.split('/').filter(Boolean);
    const documentId = event.pathParameters?.documentId ?? (pathParts[0] === 'documents' ? pathParts[1] : undefined);
    const versionValue = event.pathParameters?.versionNumber ?? (pathParts[0] === 'documents' && pathParts[2] === 'versions' ? pathParts[3] : undefined);
    const versionNumber = versionValue === undefined ? NaN : Number(versionValue);
    if (method === 'POST' && path === '/documents') { const body = parseBody(event); const input = validateDocumentInput(body.name, body.description); return response(201, await service.createDocument(userId, input.name, input.description)); }
    if (method === 'GET' && path === '/documents') return response(200, await service.listDocuments(userId));
    if (method === 'GET' && path === '/metrics') return response(200, await service.metrics(userId));
    if (!documentId) return response(404, { message: 'Route not found.' });
    if (method === 'GET' && path === `/documents/${documentId}`) return response(200, await service.getDocument(userId, documentId));
    if (method === 'GET' && path === `/documents/${documentId}/versions`) return response(200, await service.listVersions(userId, documentId));
    if (method === 'POST' && path === `/documents/${documentId}/versions/presign`) return response(201, await service.presignVersion(userId, documentId, parseBody(event)));
    if (method === 'POST' && path === `/documents/${documentId}/versions/${versionNumber}/complete`) return response(200, await service.completeVersion(userId, documentId, versionNumber));
    if (method === 'GET' && path === `/documents/${documentId}/versions/${versionNumber}/download-url`) return response(200, await service.createDownloadUrl(userId, documentId, versionNumber));
    if (method === 'POST' && path === `/documents/${documentId}/versions/${versionNumber}/share`) { const body = parseBody(event); return response(200, await service.share(userId, documentId, versionNumber, body.force === true, typeof body.reason === 'string' ? body.reason : undefined)); }
    return response(404, { message: 'Route not found.' });
  } catch (error) {
    if (error instanceof ConflictError) return response(409, error.payload);
    if (error instanceof UnauthorizedError) return response(401, { message: error.message });
    if (error instanceof ForbiddenError) return response(403, { message: error.message });
    if (error instanceof NotFoundError || error instanceof RequestValidationError) return response(error.statusCode, { message: error.message });
    console.error('Unhandled API error', error);
    return response(500, { message: 'An internal error occurred.' });
  }
}
