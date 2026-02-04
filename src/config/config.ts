import dotenv from 'dotenv';

// Load environment variables from .env file
dotenv.config();

/**
 * Application configuration loaded from environment variables
 */
export const config = {
  // Azure AD credentials
  azure: {
    tenantId: process.env.TENANT_ID || 'dummy-tenant-id',
    clientId: process.env.CLIENT_ID || 'dummy-client-id',
    clientSecret: process.env.CLIENT_SECRET || 'dummy-secret',
  },

  // Server configuration
  server: {
    port: parseInt(process.env.PORT || '3000', 10),
    nodeEnv: process.env.NODE_ENV || 'development',
  },

  // Webhook configuration
  webhook: {
    clientState: process.env.WEBHOOK_CLIENT_STATE || 'my-secret-state',
  },

  // Microsoft Graph API configuration
  graph: {
    endpoint: process.env.GRAPH_API_ENDPOINT || 'https://graph.microsoft.com/v1.0',
    scopes: ['https://graph.microsoft.com/.default'] as string[],
  },
};

/**
 * Validate that required configuration is present
 */
export function validateConfig(): void {
  const requiredVars = ['TENANT_ID', 'CLIENT_ID', 'CLIENT_SECRET'];
  const missing = requiredVars.filter(
    (varName) => !process.env[varName] || process.env[varName]?.startsWith('dummy-')
  );

  if (missing.length > 0) {
    console.warn(
      '⚠️  Warning: Using dummy credentials. The following environment variables need real values:'
    );
    console.warn(`   ${missing.join(', ')}`);
    console.warn('   Set these in your .env file once you receive credentials from IT.\n');
  }
}
