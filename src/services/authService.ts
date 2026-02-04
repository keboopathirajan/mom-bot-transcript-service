import { Client } from '@microsoft/microsoft-graph-client';
import { config } from '../config/config';
import { logger } from '../utils/logger';

/**
 * Token response from Microsoft OAuth
 */
export interface TokenResponse {
  accessToken: string;
  refreshToken: string;
  expiresAt: number; // Unix timestamp
  userId?: string;
  userEmail?: string;
}

/**
 * Generate the Microsoft OAuth authorization URL
 * This is where we redirect users to login
 */
export function getAuthUrl(): string {
  const params = new URLSearchParams({
    client_id: config.azure.clientId,
    response_type: 'code',
    redirect_uri: config.oauth.redirectUri,
    response_mode: 'query',
    scope: config.oauth.scopes.join(' '),
    state: generateState(), // CSRF protection
  });

  const authUrl = `https://login.microsoftonline.com/${config.azure.tenantId}/oauth2/v2.0/authorize?${params.toString()}`;

  logger.info('Generated auth URL for Microsoft login');
  return authUrl;
}

/**
 * Generate a random state parameter for CSRF protection
 */
function generateState(): string {
  return Math.random().toString(36).substring(2, 15) +
    Math.random().toString(36).substring(2, 15);
}

/**
 * Exchange authorization code for access and refresh tokens
 * This is called after user logs in and Microsoft redirects back
 */
export async function exchangeCodeForToken(code: string): Promise<TokenResponse> {
  try {
    logger.info('Exchanging authorization code for tokens...');

    const tokenEndpoint = `https://login.microsoftonline.com/${config.azure.tenantId}/oauth2/v2.0/token`;

    const params = new URLSearchParams({
      client_id: config.azure.clientId,
      client_secret: config.azure.clientSecret,
      code: code,
      redirect_uri: config.oauth.redirectUri,
      grant_type: 'authorization_code',
      scope: config.oauth.scopes.join(' '),
    });

    const response = await fetch(tokenEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params.toString(),
    });

    if (!response.ok) {
      const errorData = await response.text();
      logger.error('Token exchange failed:', errorData);
      throw new Error(`Token exchange failed: ${response.status}`);
    }

    const data = await response.json() as {
      access_token: string;
      refresh_token: string;
      expires_in: number;
    };

    // Calculate token expiration time
    const expiresAt = Date.now() + (data.expires_in * 1000);

    const tokenResponse: TokenResponse = {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresAt: expiresAt,
    };

    logger.info('✅ Successfully obtained access token');

    // Get user info
    try {
      const userInfo = await getUserInfo(tokenResponse.accessToken);
      tokenResponse.userId = userInfo.id;
      tokenResponse.userEmail = userInfo.mail || userInfo.userPrincipalName;
      logger.info(`✅ Logged in as: ${tokenResponse.userEmail}`);
    } catch (error) {
      logger.warn('Could not fetch user info, continuing without it');
    }

    return tokenResponse;
  } catch (error) {
    logger.error('❌ Failed to exchange code for token', error);
    throw error;
  }
}

/**
 * Refresh an expired access token using the refresh token
 */
export async function refreshAccessToken(refreshToken: string): Promise<TokenResponse> {
  try {
    logger.info('Refreshing access token...');

    const tokenEndpoint = `https://login.microsoftonline.com/${config.azure.tenantId}/oauth2/v2.0/token`;

    const params = new URLSearchParams({
      client_id: config.azure.clientId,
      client_secret: config.azure.clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
      scope: config.oauth.scopes.join(' '),
    });

    const response = await fetch(tokenEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params.toString(),
    });

    if (!response.ok) {
      const errorData = await response.text();
      logger.error('Token refresh failed:', errorData);
      throw new Error(`Token refresh failed: ${response.status}`);
    }

    const data = await response.json() as {
      access_token: string;
      refresh_token?: string;
      expires_in: number;
    };

    const expiresAt = Date.now() + (data.expires_in * 1000);

    logger.info('✅ Successfully refreshed access token');

    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token || refreshToken, // Use new refresh token if provided
      expiresAt: expiresAt,
    };
  } catch (error) {
    logger.error('❌ Failed to refresh token', error);
    throw error;
  }
}

/**
 * Check if the access token is expired or about to expire (within 5 minutes)
 */
export function isTokenExpired(tokenResponse: TokenResponse): boolean {
  const bufferTime = 5 * 60 * 1000; // 5 minutes buffer
  return Date.now() >= (tokenResponse.expiresAt - bufferTime);
}

/**
 * Get a valid access token, refreshing if necessary
 */
export async function getValidAccessToken(tokenResponse: TokenResponse): Promise<TokenResponse> {
  if (isTokenExpired(tokenResponse)) {
    logger.info('Access token expired, refreshing...');
    return await refreshAccessToken(tokenResponse.refreshToken);
  }
  return tokenResponse;
}

/**
 * Create a Microsoft Graph client using the user's access token
 * This client can only access resources the user has permission to
 */
export function getUserGraphClient(accessToken: string): Client {
  const client = Client.init({
    authProvider: (done) => {
      done(null, accessToken);
    },
  });

  return client;
}

/**
 * Get user profile information using the access token
 */
async function getUserInfo(accessToken: string): Promise<{ id: string; mail: string; userPrincipalName: string }> {
  const client = getUserGraphClient(accessToken);
  const user = await client.api('/me').select('id,mail,userPrincipalName').get();
  return user;
}

/**
 * Test the user's Graph connection by fetching their profile
 */
export async function testUserConnection(accessToken: string): Promise<boolean> {
  try {
    logger.info('Testing user Graph connection...');
    const client = getUserGraphClient(accessToken);
    const user = await client.api('/me').get();
    logger.info(`✅ Connected as: ${user.displayName} (${user.mail || user.userPrincipalName})`);
    return true;
  } catch (error: any) {
    logger.error('❌ User Graph connection test failed', error);
    return false;
  }
}
