import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as cdk from 'aws-cdk-lib';
import { aws_apigatewayv2_authorizers as authorizers, aws_apigatewayv2 as apigwv2, aws_cognito as cognito, aws_dynamodb as dynamodb, aws_lambda as lambda, aws_logs as logs, aws_s3 as s3 } from 'aws-cdk-lib';
import { HttpLambdaIntegration } from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { Construct } from 'constructs';

export class VersionGuardStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);
    const backendEntry = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../backend/src/handlers/api.ts');

    const userPool = new cognito.UserPool(this, 'UserPool', {
      userPoolName: 'versionguard-users',
      selfSignUpEnabled: true,
      signInAliases: { email: true },
      autoVerify: { email: true },
      passwordPolicy: { minLength: 12, requireDigits: true, requireLowercase: true, requireUppercase: true, requireSymbols: true },
      accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });
    const userPoolClient = userPool.addClient('WebClient', { generateSecret: false, authFlows: { userPassword: true, userSrp: true } });

    const uploadsBucket = new s3.Bucket(this, 'UploadsBucket', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      versioned: true,
      enforceSSL: true,
      cors: [{ allowedMethods: [s3.HttpMethods.PUT, s3.HttpMethods.GET, s3.HttpMethods.HEAD], allowedOrigins: ['*'], allowedHeaders: ['*'], exposedHeaders: ['ETag'] }],
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });
    const frontendBucket = new s3.Bucket(this, 'FrontendBucket', {
      blockPublicAccess: new s3.BlockPublicAccess({ blockPublicAcls: true, blockPublicPolicy: false, ignorePublicAcls: true, restrictPublicBuckets: false }),
      encryption: s3.BucketEncryption.S3_MANAGED,
      publicReadAccess: true,
      websiteIndexDocument: 'index.html',
      websiteErrorDocument: 'index.html',
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });
    const documentsTable = new dynamodb.Table(this, 'DocumentsTable', { partitionKey: { name: 'userId', type: dynamodb.AttributeType.STRING }, sortKey: { name: 'entityKey', type: dynamodb.AttributeType.STRING }, billingMode: dynamodb.BillingMode.PAY_PER_REQUEST, encryption: dynamodb.TableEncryption.AWS_MANAGED, removalPolicy: cdk.RemovalPolicy.DESTROY });
    const versionsTable = new dynamodb.Table(this, 'VersionsTable', { partitionKey: { name: 'documentId', type: dynamodb.AttributeType.STRING }, sortKey: { name: 'versionNumber', type: dynamodb.AttributeType.NUMBER }, billingMode: dynamodb.BillingMode.PAY_PER_REQUEST, encryption: dynamodb.TableEncryption.AWS_MANAGED, removalPolicy: cdk.RemovalPolicy.DESTROY });

    const apiFunction = new NodejsFunction(this, 'ApiFunction', { runtime: lambda.Runtime.NODEJS_22_X, entry: backendEntry, handler: 'handler', timeout: cdk.Duration.seconds(30), memorySize: 512, tracing: lambda.Tracing.PASS_THROUGH, environment: { DOCUMENTS_TABLE: documentsTable.tableName, VERSIONS_TABLE: versionsTable.tableName, UPLOADS_BUCKET: uploadsBucket.bucketName, FRONTEND_ORIGIN: '*' }, logRetention: logs.RetentionDays.ONE_WEEK });
    documentsTable.grantReadWriteData(apiFunction);
    versionsTable.grantReadWriteData(apiFunction);
    uploadsBucket.grantReadWrite(apiFunction);

    const httpApi = new apigwv2.HttpApi(this, 'HttpApi', { apiName: 'versionguard-api', corsPreflight: { allowHeaders: ['authorization', 'content-type', 'x-versionguard-client-request-id'], allowMethods: [apigwv2.CorsHttpMethod.ANY], allowOrigins: ['*'], maxAge: cdk.Duration.hours(1) } });
    const integration = new HttpLambdaIntegration('ApiIntegration', apiFunction);
    httpApi.addRoutes({ path: '/health', methods: [apigwv2.HttpMethod.GET], integration });
    const issuer = `https://cognito-idp.${this.region}.amazonaws.com/${userPool.userPoolId}`;
    const jwtAuthorizer = new authorizers.HttpJwtAuthorizer('CognitoAuthorizer', issuer, { jwtAudience: [userPoolClient.userPoolClientId] });
    httpApi.addRoutes({ path: '/{proxy+}', methods: [apigwv2.HttpMethod.OPTIONS], integration });
    httpApi.addRoutes({ path: '/{proxy+}', methods: [apigwv2.HttpMethod.GET, apigwv2.HttpMethod.POST, apigwv2.HttpMethod.PUT, apigwv2.HttpMethod.PATCH, apigwv2.HttpMethod.DELETE, apigwv2.HttpMethod.HEAD], integration, authorizer: jwtAuthorizer });

    new cdk.CfnOutput(this, 'UserPoolId', { value: userPool.userPoolId });
    new cdk.CfnOutput(this, 'UserPoolClientId', { value: userPoolClient.userPoolClientId });
    new cdk.CfnOutput(this, 'ApiUrl', { value: httpApi.url ?? '' });
    new cdk.CfnOutput(this, 'Region', { value: this.region });
    new cdk.CfnOutput(this, 'UploadsBucketName', { value: uploadsBucket.bucketName });
    new cdk.CfnOutput(this, 'FrontendBucketName', { value: frontendBucket.bucketName });
    new cdk.CfnOutput(this, 'FrontendWebsiteUrl', { value: frontendBucket.bucketWebsiteUrl });
  }
}
