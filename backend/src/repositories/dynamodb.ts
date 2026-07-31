import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { randomUUID } from 'node:crypto';
import { DocumentRecord, UserStats, VersionRecord } from '@versionguard/shared';
import { DocumentRepository, StatsRepository, VersionRepository } from './interfaces.js';

export class DynamoDocumentRepository implements DocumentRepository {
  constructor(private readonly client: DynamoDBDocumentClient, private readonly tableName: string) {}

  async create(userId: string, name: string, description: string | undefined, now: string): Promise<DocumentRecord> {
    const document: DocumentRecord = { userId, entityKey: `DOC#${randomUUID()}`, documentId: '', name, description, nextVersionNumber: 1, versionCount: 0, createdAt: now, updatedAt: now };
    document.documentId = document.entityKey.slice(5);
    await this.client.send(new PutCommand({ TableName: this.tableName, Item: document, ConditionExpression: 'attribute_not_exists(userId)' }));
    return document;
  }

  async listByUser(userId: string): Promise<DocumentRecord[]> {
    const result = await this.client.send(new QueryCommand({ TableName: this.tableName, KeyConditionExpression: 'userId = :userId AND begins_with(entityKey, :prefix)', ExpressionAttributeValues: { ':userId': userId, ':prefix': 'DOC#' } }));
    return (result.Items ?? []) as DocumentRecord[];
  }

  async getOwned(userId: string, documentId: string): Promise<DocumentRecord | undefined> {
    const result = await this.client.send(new GetCommand({ TableName: this.tableName, Key: { userId, entityKey: `DOC#${documentId}` }, ConsistentRead: true }));
    return result.Item as DocumentRecord | undefined;
  }

  async allocateVersion(userId: string, documentId: string, now: string) {
    const result = await this.client.send(new UpdateCommand({ TableName: this.tableName, Key: { userId, entityKey: `DOC#${documentId}` }, UpdateExpression: 'SET nextVersionNumber = if_not_exists(nextVersionNumber, :first) + :one, updatedAt = :now', ConditionExpression: 'attribute_exists(userId)', ExpressionAttributeValues: { ':first': 1, ':one': 1, ':now': now }, ReturnValues: 'ALL_NEW' }));
    const document = result.Attributes as DocumentRecord;
    return { document, versionNumber: document.nextVersionNumber - 1 };
  }

  async recordCompletedVersion(userId: string, documentId: string, versionNumber: number, now: string): Promise<void> {
    await this.client.send(new UpdateCommand({ TableName: this.tableName, Key: { userId, entityKey: `DOC#${documentId}` }, UpdateExpression: 'SET versionCount = if_not_exists(versionCount, :zero) + :one, updatedAt = :now', ConditionExpression: 'attribute_exists(userId)', ExpressionAttributeValues: { ':zero': 0, ':one': 1, ':now': now } }));
    try {
      await this.client.send(new UpdateCommand({ TableName: this.tableName, Key: { userId, entityKey: `DOC#${documentId}` }, UpdateExpression: 'SET latestVersionNumber = :version, updatedAt = :now', ConditionExpression: 'attribute_not_exists(latestVersionNumber) OR latestVersionNumber < :version', ExpressionAttributeValues: { ':version': versionNumber, ':now': now } }));
    } catch (error) {
      if ((error as { name?: string }).name !== 'ConditionalCheckFailedException') throw error;
    }
  }
}

export class DynamoVersionRepository implements VersionRepository {
  constructor(private readonly client: DynamoDBDocumentClient, private readonly tableName: string) {}

  async createPending(version: VersionRecord): Promise<void> {
    await this.client.send(new PutCommand({ TableName: this.tableName, Item: version, ConditionExpression: 'attribute_not_exists(documentId)' }));
  }

  async getOwned(userId: string, documentId: string, versionNumber: number): Promise<VersionRecord | undefined> {
    const result = await this.client.send(new GetCommand({ TableName: this.tableName, Key: { documentId, versionNumber } }));
    const version = result.Item as VersionRecord | undefined;
    return version?.userId === userId ? version : undefined;
  }

  async listOwned(userId: string, documentId: string): Promise<VersionRecord[]> {
    const result = await this.client.send(new QueryCommand({ TableName: this.tableName, KeyConditionExpression: 'documentId = :documentId', ExpressionAttributeValues: { ':documentId': documentId }, ScanIndexForward: false }));
    return (result.Items as VersionRecord[] | undefined ?? []).filter((version) => version.userId === userId);
  }

  async complete(version: VersionRecord, completedAt: string): Promise<VersionRecord> {
    const result = await this.client.send(new UpdateCommand({ TableName: this.tableName, Key: { documentId: version.documentId, versionNumber: version.versionNumber }, UpdateExpression: 'SET #status = :complete, completedAt = :completedAt', ConditionExpression: '#status = :pending', ExpressionAttributeNames: { '#status': 'status' }, ExpressionAttributeValues: { ':complete': 'COMPLETE', ':pending': 'PENDING', ':completedAt': completedAt }, ReturnValues: 'ALL_NEW' }));
    return result.Attributes as VersionRecord;
  }

  async findByHash(userId: string, documentId: string, sha256: string): Promise<VersionRecord | undefined> {
    const versions = await this.listOwned(userId, documentId);
    return versions.find((version) => version.sha256 === sha256 && version.status === 'COMPLETE');
  }
}

export class DynamoStatsRepository implements StatsRepository {
  constructor(private readonly client: DynamoDBDocumentClient, private readonly tableName: string) {}

  async get(userId: string): Promise<UserStats> {
    const result = await this.client.send(new GetCommand({ TableName: this.tableName, Key: { userId, entityKey: 'STATS' } }));
    return (result.Item as UserStats | undefined) ?? { userId, entityKey: 'STATS', staleWarnings: 0, forcedOlderShares: 0, totalShares: 0, latestShares: 0 };
  }

  async increment(userId: string, updates: Partial<Pick<UserStats, 'staleWarnings' | 'forcedOlderShares' | 'totalShares' | 'latestShares'>>): Promise<UserStats> {
    const names: Record<string, string> = {};
    const values: Record<string, number> = {};
    const expressions: string[] = [];
    for (const [field, amount] of Object.entries(updates)) {
      if (!amount) continue;
      names[`#${field}`] = field;
      values[`:${field}`] = amount;
      expressions.push(`#${field} = if_not_exists(#${field}, :zero) + :${field}`);
    }
    if (!expressions.length) return this.get(userId);
    const result = await this.client.send(new UpdateCommand({ TableName: this.tableName, Key: { userId, entityKey: 'STATS' }, UpdateExpression: `SET ${expressions.join(', ')}`, ExpressionAttributeNames: names, ExpressionAttributeValues: { ...values, ':zero': 0 }, ReturnValues: 'ALL_NEW' }));
    return result.Attributes as UserStats;
  }
}

export function createDynamoDocumentClient(): DynamoDBDocumentClient {
  return DynamoDBDocumentClient.from(new DynamoDBClient({}));
}
