import { APIGatewayProxyEventV2WithJWTAuthorizer } from 'aws-lambda';

export class UnauthorizedError extends Error {
  public readonly statusCode = 401;
}

export function getUserId(event: APIGatewayProxyEventV2WithJWTAuthorizer): string {
  const claims = event.requestContext.authorizer?.jwt?.claims;
  const subject = claims?.sub;
  if (typeof subject !== 'string' || !subject) throw new UnauthorizedError('Authentication required.');
  return subject;
}
