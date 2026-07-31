#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { VersionGuardStack } from '../lib/versionguard-stack.js';

const app = new cdk.App();
new VersionGuardStack(app, 'VersionGuardStack', {
  env: { account: process.env.CDK_DEFAULT_ACCOUNT, region: process.env.CDK_DEFAULT_REGION ?? process.env.AWS_REGION ?? 'us-east-1' },
});
