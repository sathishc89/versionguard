import { createReadStream } from 'node:fs';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';

const contentTypes: Record<string, string> = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon' };
const region = process.env.AWS_REGION ?? process.env.AWS_DEFAULT_REGION ?? 'us-east-1';
const stackName = process.env.CDK_STACK_NAME ?? 'VersionGuardStack';

async function filesIn(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) { const fullPath = path.join(directory, entry.name); if (entry.isDirectory()) files.push(...await filesIn(fullPath)); else files.push(fullPath); }
  return files;
}

async function main() {
  let outputs: Record<string, string> = {};
  try { const file = JSON.parse(await readFile(path.resolve('cdk-outputs.json'), 'utf8')) as Record<string, Record<string, string>>; outputs = file[stackName] ?? {}; } catch {}
  const bucket = process.env.FRONTEND_BUCKET_NAME ?? outputs.FrontendBucketName;
  if (!bucket) throw new Error('FRONTEND_BUCKET_NAME is required. Deploy infrastructure first or set it in the environment.');
  const dist = path.resolve('frontend/dist');
  const s3 = new S3Client({ region });
  const files = await filesIn(dist);
  await Promise.all(files.map(async (file) => { const key = path.relative(dist, file).replaceAll('\\', '/'); const extension = path.extname(file).toLowerCase(); await s3.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: createReadStream(file), ContentType: contentTypes[extension] ?? 'application/octet-stream', CacheControl: key === 'index.html' ? 'no-cache, no-store, must-revalidate' : 'public, max-age=31536000, immutable' })); }));
  console.log(`Uploaded ${files.length} frontend files to s3://${bucket}`);
  console.log(`Frontend URL: ${outputs.FrontendWebsiteUrl ?? 'check the CloudFormation output'}`);
}

main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
