import { App } from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { describe, expect, it } from 'vitest';
import { VersionGuardStack } from '../lib/versionguard-stack.js';

describe('VersionGuardStack', () => {
  const template = Template.fromStack(new VersionGuardStack(new App(), 'TestStack', { env: { account: '123456789012', region: 'us-east-1' } }));

  it('creates private versioned encrypted upload storage', () => {
    template.hasResourceProperties('AWS::S3::Bucket', { VersioningConfiguration: { Status: 'Enabled' }, BucketEncryption: { ServerSideEncryptionConfiguration: [{ ServerSideEncryptionByDefault: { SSEAlgorithm: 'AES256' } }] }, PublicAccessBlockConfiguration: { BlockPublicAcls: true, BlockPublicPolicy: true, IgnorePublicAcls: true, RestrictPublicBuckets: true } });
  });
  it('creates the requested DynamoDB keys', () => {
    template.hasResourceProperties('AWS::DynamoDB::Table', { KeySchema: [{ AttributeName: 'userId', KeyType: 'HASH' }, { AttributeName: 'entityKey', KeyType: 'RANGE' }] });
    template.hasResourceProperties('AWS::DynamoDB::Table', { KeySchema: [{ AttributeName: 'documentId', KeyType: 'HASH' }, { AttributeName: 'versionNumber', KeyType: 'RANGE' }] });
  });
  it('configures Cognito JWT authorization and CloudFront', () => {
    template.resourceCountIs('AWS::Cognito::UserPoolClient', 1);
    template.hasResourceProperties('AWS::ApiGatewayV2::Authorizer', { AuthorizerType: 'JWT' });
    template.resourceCountIs('AWS::CloudFront::Distribution', 1);
  });
});
