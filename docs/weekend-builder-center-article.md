# Weekend Annoying Task Challenge: VersionGuard

**Tag:** `#productivity`

**Live demo:** [PASTE YOUR LIVE FRONTEND URL HERE]

**Source code:** https://github.com/sathishc89/versionguard

## The annoying task

One of the most avoidable mistakes in everyday work is sharing the wrong file. A project plan gets revised, a presentation is updated, or a contract receives a final approval, but an older attachment is still sitting in a downloads folder or email draft. The problem is not usually a lack of version history. The problem is that the person sharing the file has no reliable pause point that asks, "Is this really the latest version?"

VersionGuard was built to make that moment explicit. It groups related files into a document, tracks completed versions, and warns the user when they try to share anything older than the latest completed version. The user can switch to the latest version, share the older version with a reason, or cancel. This keeps the workflow practical: VersionGuard prevents accidental mistakes without blocking legitimate cases where an older approved file still needs to be shared.

## What I built

The application starts with email-based sign-up and authentication through Amazon Cognito. After signing in, a user can create a document group such as "Project Plan" and upload its first file. The browser calculates a SHA-256 hash before requesting an upload URL. The backend validates the metadata, allocates the next version number, and returns a short-lived presigned Amazon S3 URL. The browser uploads directly to S3 and then calls the completion endpoint. A version is not considered latest until the upload has been confirmed successfully.

The version history shows file names, notes, upload dates, status, and the latest badge. When a user selects an older completed version to share, the backend compares its number with the highest completed version. If it is stale, the API returns a conflict instead of silently generating a link. The interface then presents the three deliberate choices: use the latest version, share the selected version anyway, or cancel. Successful shares use short-lived presigned download URLs rather than permanent public links.

## AWS architecture

VersionGuard uses AWS CDK v2 to define the infrastructure as code. Amazon Cognito User Pools provide email sign-up, verification, and JWT tokens. API Gateway HTTP API is the authenticated entry point, with a Cognito JWT authorizer protecting application routes. AWS Lambda runs the TypeScript API and version-guard business logic.

Amazon DynamoDB stores document records, version records, and per-user sharing metrics. The version allocation operation uses an atomic update so concurrent uploads do not receive the same number. Pending uploads are excluded from latest-version decisions, and completion updates the document only when a higher completed version is available.

Amazon S3 stores uploaded files in a private, encrypted, versioned bucket. The browser never receives AWS credentials and never accesses DynamoDB directly. It receives only short-lived presigned URLs for upload and download. CloudWatch Logs provide diagnostics for the Lambda function.

For this first account, AWS account verification temporarily blocked creation of a CloudFront distribution. To keep the demo available for the challenge, the frontend is currently served from an S3 static website endpoint while the backend remains protected by Cognito and API Gateway. This is a deliberate temporary deployment path. The intended production architecture uses a private frontend bucket with CloudFront Origin Access Control and HTTPS delivery once CloudFront access is enabled.

## Building lessons

The most useful design decision was separating a pending version from a completed version. Without that distinction, a failed or interrupted upload could incorrectly become the latest file. Deterministic version checks also made the warning behavior easy to test with repository fakes before deploying to AWS.

The deployment process exposed two practical lessons. First, corporate proxy TLS settings can affect AWS CLI access even when credentials are valid; a trusted direct network solved that issue without disabling SSL verification. Second, AWS service access can be restricted independently of IAM permissions. The account could create most resources but was not yet allowed to create CloudFront distributions, so the frontend hosting layer needed a temporary fallback.

The result is a focused productivity tool with a small AWS footprint, auditable version decisions, and a workflow that turns a familiar annoying task into a visible, testable checkpoint.

## Links

- Repository: https://github.com/sathishc89/versionguard
- Live demo: [PASTE YOUR LIVE FRONTEND URL HERE]
