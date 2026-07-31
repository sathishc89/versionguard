import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { CloudFormationClient, DescribeStacksCommand } from '@aws-sdk/client-cloudformation';

const stackName = process.env.CDK_STACK_NAME ?? 'VersionGuardStack';
const region = process.env.AWS_REGION ?? process.env.AWS_DEFAULT_REGION ?? 'us-east-1';
const outputsFile = path.resolve('cdk-outputs.json');

async function main() {
  let outputs: Record<string, string> | undefined;
  try {
    const file = JSON.parse(await readFile(outputsFile, 'utf8')) as Record<string, Record<string, string>>;
    outputs = file[stackName];
  } catch {
    const cloudFormation = new CloudFormationClient({ region });
    const result = await cloudFormation.send(new DescribeStacksCommand({ StackName: stackName }));
    outputs = Object.fromEntries((result.Stacks?.[0]?.Outputs ?? []).map((output) => [output.OutputKey ?? '', output.OutputValue ?? '']));
  }
  if (!outputs?.UserPoolId || !outputs.UserPoolClientId || !outputs.ApiUrl) throw new Error(`Could not find VersionGuard outputs for ${stackName}. Deploy infrastructure first.`);
  const runtime = { region: outputs.Region ?? region, userPoolId: outputs.UserPoolId, userPoolClientId: outputs.UserPoolClientId, apiUrl: outputs.ApiUrl, cloudFrontUrl: outputs.CloudFrontUrl ?? '' };
  await writeFile(path.resolve('frontend/public/runtime-config.json'), `${JSON.stringify(runtime, null, 2)}\n`, 'utf8');
  console.log(`Frontend runtime configuration written for ${stackName}.`);
  console.log(`API: ${runtime.apiUrl}`);
  console.log(`CloudFront: ${runtime.cloudFrontUrl}`);
}

main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
