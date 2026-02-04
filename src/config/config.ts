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
    baseUrl: process.env.BASE_URL || 'http://localhost:3000',
  },

  // Webhook configuration
  webhook: {
    clientState: process.env.WEBHOOK_CLIENT_STATE || 'my-secret-state',
  },

  // Microsoft Graph API configuration (for application permissions)
  graph: {
    endpoint: process.env.GRAPH_API_ENDPOINT || 'https://graph.microsoft.com/v1.0',
    scopes: ['https://graph.microsoft.com/.default'] as string[],
  },

  // OAuth configuration (for delegated permissions)
  oauth: {
    redirectUri: process.env.REDIRECT_URI || 'http://localhost:3000/auth/callback',
    // Delegated permission scopes - only access user's own data
    scopes: [
      'openid',
      'profile',
      'offline_access', // Required for refresh tokens
      'User.Read', // Read user profile
      'OnlineMeetings.Read', // Read user's meetings and transcripts
    ],
  },

  // Session configuration
  session: {
    secret: process.env.SESSION_SECRET || 'mom-bot-session-secret-change-in-production',
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

  // Check OAuth redirect URI in production
  if (config.server.nodeEnv === 'production' && config.oauth.redirectUri.includes('localhost')) {
    console.warn(
      '⚠️  Warning: REDIRECT_URI is set to localhost in production.'
    );
    console.warn('   Update REDIRECT_URI to your production URL.\n');
  }

  // Check session secret in production
  if (config.server.nodeEnv === 'production' && config.session.secret.includes('change-in-production')) {
    console.warn(
      '⚠️  Warning: Using default SESSION_SECRET in production.'
    );
    console.warn('   Set a strong, unique SESSION_SECRET in production.\n');
  }
}
