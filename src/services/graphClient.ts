import { ClientSecretCredential } from '@azure/identity';
import { Client } from '@microsoft/microsoft-graph-client';
import { TokenCredentialAuthenticationProvider } from '@microsoft/microsoft-graph-client/authProviders/azureTokenCredentials';
import { config } from '../config/config';
import { logger } from '../utils/logger';

/**
 * Graph client instance for APPLICATION permissions (client credentials flow)
 * This is used when IT grants app-level permissions like OnlineMeetings.Read.All
 * 
 * For DELEGATED permissions (user's own meetings), use getUserGraphClient() from authService.ts
 */
let graphClient: Client | null = null;

/**
 * Initialize and return the Microsoft Graph client using APPLICATION permissions
 * Uses Azure AD client credentials flow for authentication
 * 
 * This requires IT to grant application-level permissions (e.g., OnlineMeetings.Read.All)
 * For user-level access (delegated permissions), use authService.ts instead
 */
export function getGraphClient(): Client {
  if (graphClient) {
    return graphClient;
  }

  try {
    logger.info('Initializing Microsoft Graph client...');

    // Create Azure AD credential using client secret
    const credential = new ClientSecretCredential(
      config.azure.tenantId,
      config.azure.clientId,
      config.azure.clientSecret
    );

    // Create authentication provider
    const authProvider = new TokenCredentialAuthenticationProvider(credential, {
      scopes: config.graph.scopes,
    });

    // Initialize Graph client
    graphClient = Client.initWithMiddleware({
      authProvider,
    });

    logger.info('✅ Microsoft Graph client initialized successfully');
    return graphClient;
  } catch (error) {
    logger.error('❌ Failed to initialize Microsoft Graph client', error);
    throw new Error('Failed to initialize Graph client. Check your Azure AD credentials.');
  }
}

/**
 * Test the Graph client by making a simple request
 * This helps verify that authentication is working
 */
export async function testGraphConnection(): Promise<boolean> {
  try {
    logger.info('Testing Microsoft Graph connection...');
    const client = getGraphClient();

    // Try to get the organization information (basic test)
    await client.api('/organization').get();

    logger.info('✅ Microsoft Graph connection test successful');
    return true;
  } catch (error: any) {
    if (error.statusCode === 401 || error.statusCode === 403) {
      logger.error('❌ Authentication failed. Check your credentials and permissions.', error);
    } else if (error.code === 'ENOTFOUND' || error.code === 'ETIMEDOUT') {
      logger.error('❌ Network error. Check your internet connection.', error);
    } else {
      logger.error('❌ Graph API connection test failed', error);
    }
    return false;
  }
}

/**
 * Get an access token for debugging purposes
 */
export async function getAccessToken(): Promise<string> {
  try {
    const credential = new ClientSecretCredential(
      config.azure.tenantId,
      config.azure.clientId,
      config.azure.clientSecret
    );

    const tokenResponse = await credential.getToken(config.graph.scopes);
    return tokenResponse.token;
  } catch (error) {
    logger.error('Failed to get access token', error);
    throw error;
  }
}
