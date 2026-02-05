import express, { Request, Response, NextFunction } from 'express';
import session from 'express-session';
import path from 'path';
import { config, validateConfig } from './config/config';
import { logger } from './utils/logger';
import { testGraphConnection } from './services/graphClient';
import {
  handleWebhookValidation,
  handleWebhookNotification,
  handleManualTrigger,
  handleListMeetings,
} from './services/webhookHandler';
import {
  getAuthUrl,
  exchangeCodeForToken,
  getValidAccessToken,
  testUserConnection,
  TokenResponse,
} from './services/authService';

// Extend Express Session to include our token data
declare module 'express-session' {
  interface SessionData {
    tokens?: TokenResponse;
  }
}

// Initialize Express app
const app = express();

// Trust proxy - REQUIRED for secure cookies behind Render/Heroku/etc
app.set('trust proxy', 1);

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// CORS middleware - Allow local frontend dev to call Render backend
app.use((req: Request, res: Response, next: NextFunction) => {
  const allowedOrigins = [
    'http://localhost:5173',      // Vite dev server
    'http://localhost:3000',      // Local backend
    'http://127.0.0.1:5173',
    'http://127.0.0.1:3000',
  ];

  const origin = req.headers.origin;
  if (origin && allowedOrigins.includes(origin)) {
    res.header('Access-Control-Allow-Origin', origin);
    res.header('Access-Control-Allow-Credentials', 'true');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  }

  // Handle preflight requests
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  next();
});

// Session middleware for storing user tokens
app.use(
  session({
    secret: config.session.secret,
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: config.server.nodeEnv === 'production', // HTTPS only in production
      httpOnly: true,
      // 'none' allows cross-origin requests (local frontend -> Render backend)
      // 'lax' is used in dev to allow OAuth redirects without Secure requirement
      sameSite: config.server.nodeEnv === 'production' ? 'none' : 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    },
  })
);

// Request logging middleware
app.use((req: Request, res: Response, next: NextFunction) => {
  logger.info(`${req.method} ${req.path}`);
  next();
});

/**
 * Health check endpoint
 */
app.get('/health', (req: Request, res: Response) => {
  res.status(200).json({
    status: 'ok',
    service: 'MoM Bot Transcript Service',
    timestamp: new Date().toISOString(),
  });
});

/**
 * Webhook endpoint - handles both validation and notifications
 * GET: Webhook validation (subscription setup)
 * POST: Webhook notifications (meeting events)
 */
app.get('/webhook', (req: Request, res: Response) => {
  handleWebhookValidation(req, res);
});

app.post('/webhook', async (req: Request, res: Response) => {
  await handleWebhookNotification(req, res);
});

// ============================================================
// OAuth Authentication Endpoints (Delegated Permissions)
// ============================================================

/**
 * Start OAuth login flow
 * GET /auth/login
 * Redirects user to Microsoft login page
 */
app.get('/auth/login', (req: Request, res: Response) => {
  logger.info('Starting OAuth login flow...');
  const authUrl = getAuthUrl();
  res.redirect(authUrl);
});

/**
 * OAuth callback - handles redirect from Microsoft after login
 * GET /auth/callback
 * Microsoft redirects here with authorization code
 */
app.get('/auth/callback', async (req: Request, res: Response) => {
  try {
    const code = req.query.code as string;
    const error = req.query.error as string;
    const errorDescription = req.query.error_description as string;

    // Check for errors from Microsoft
    if (error) {
      logger.error(`OAuth error: ${error} - ${errorDescription}`);
      return res.status(400).json({
        error: 'Authentication failed',
        message: errorDescription || error,
      });
    }

    if (!code) {
      logger.error('No authorization code received');
      return res.status(400).json({
        error: 'Missing authorization code',
        message: 'No code parameter in callback URL',
      });
    }

    logger.info('Received authorization code, exchanging for tokens...');

    // Exchange code for tokens
    const tokens = await exchangeCodeForToken(code);

    // Store tokens in session
    req.session.tokens = tokens;

    logger.info('✅ User authenticated successfully');

    // Explicitly save session before redirect
    req.session.save((err) => {
      if (err) {
        logger.error('Failed to save session', err);
        return res.status(500).json({ error: 'Session save failed' });
      }
      // Redirect to status page
      res.redirect('/auth/status');
    });
  } catch (error: any) {
    logger.error('OAuth callback failed', error);
    res.status(500).json({
      error: 'Authentication failed',
      message: error.message,
    });
  }
});

/**
 * Check authentication status
 * GET /auth/status
 * Returns current login status and user info
 */
app.get('/auth/status', async (req: Request, res: Response) => {
  try {
    if (!req.session.tokens) {
      return res.status(200).json({
        authenticated: false,
        message: 'Not logged in. Visit /auth/login to authenticate.',
        loginUrl: '/auth/login',
      });
    }

    // Get valid token (refresh if needed)
    const tokens = await getValidAccessToken(req.session.tokens);
    req.session.tokens = tokens; // Update session with potentially refreshed tokens

    // Calculate time until expiration
    const expiresIn = Math.round((tokens.expiresAt - Date.now()) / 1000 / 60);

    res.status(200).json({
      authenticated: true,
      user: {
        email: tokens.userEmail || 'Unknown',
        id: tokens.userId,
      },
      tokenExpiresIn: `${expiresIn} minutes`,
      message: 'You are authenticated. You can now fetch your meeting transcripts.',
      endpoints: {
        'POST /transcript/fetch': 'Fetch transcript (uses your auth)',
        'GET /auth/logout': 'Logout',
        'GET /auth/test': 'Test your Graph API connection',
      },
    });
  } catch (error: any) {
    logger.error('Failed to check auth status', error);
    // Clear invalid session
    req.session.destroy(() => { });
    res.status(401).json({
      authenticated: false,
      message: 'Session expired. Please login again.',
      loginUrl: '/auth/login',
    });
  }
});

/**
 * Test user's Graph API connection
 * GET /auth/test
 * Verifies the user's token works with Graph API
 */
app.get('/auth/test', async (req: Request, res: Response) => {
  try {
    if (!req.session.tokens) {
      return res.status(401).json({
        success: false,
        message: 'Not authenticated. Visit /auth/login first.',
      });
    }

    const tokens = await getValidAccessToken(req.session.tokens);
    req.session.tokens = tokens;

    const isConnected = await testUserConnection(tokens.accessToken);

    if (isConnected) {
      res.status(200).json({
        success: true,
        message: 'Graph API connection successful! You can access your meetings.',
      });
    } else {
      res.status(500).json({
        success: false,
        message: 'Graph API connection failed. Check permissions.',
      });
    }
  } catch (error: any) {
    res.status(500).json({
      success: false,
      message: 'Connection test failed',
      error: error.message,
    });
  }
});

/**
 * Logout - clear session
 * GET /auth/logout
 */
app.get('/auth/logout', (req: Request, res: Response) => {
  const hadSession = !!req.session.tokens;

  req.session.destroy((err) => {
    if (err) {
      logger.error('Failed to destroy session', err);
      return res.status(500).json({ error: 'Logout failed' });
    }

    logger.info('User logged out');
    res.status(200).json({
      success: true,
      message: hadSession ? 'Logged out successfully' : 'No active session',
      loginUrl: '/auth/login',
    });
  });
});

// ============================================================
// Transcript Endpoints
// ============================================================

/**
 * List user's meetings (requires authentication)
 * GET /meetings
 * Returns list of meetings the logged-in user has organized
 */
app.get('/meetings', async (req: Request, res: Response) => {
  await handleListMeetings(req, res);
});

/**
 * Manual trigger endpoint for testing
 * POST /transcript/fetch
 * Body: { meetingId: string, organizerId?: string }
 * - If authenticated: only meetingId required (uses your credentials)
 * - If not authenticated: both meetingId and organizerId required
 */
app.post('/transcript/fetch', async (req: Request, res: Response) => {
  await handleManualTrigger(req, res);
});

/**
 * Get meeting transcript by ID (alternative endpoint)
 * POST /transcript/:meetingId
 * Body: { organizerId: string }
 */
app.post('/transcript/:meetingId', async (req: Request, res: Response) => {
  const { meetingId } = req.params;
  const { organizerId } = req.body;

  await handleManualTrigger(
    { ...req, body: { meetingId, organizerId } } as Request,
    res
  );
});

/**
 * Test Graph API connection
 * GET /test/connection
 */
app.get('/test/connection', async (req: Request, res: Response) => {
  try {
    const isConnected = await testGraphConnection();

    if (isConnected) {
      res.status(200).json({
        success: true,
        message: 'Microsoft Graph connection successful',
      });
    } else {
      res.status(500).json({
        success: false,
        message: 'Microsoft Graph connection failed',
      });
    }
  } catch (error: any) {
    res.status(500).json({
      success: false,
      message: 'Connection test failed',
      error: error.message,
    });
  }
});

/**
 * Root endpoint - API information
 */
app.get('/', (req: Request, res: Response) => {
  const isAuthenticated = !!req.session?.tokens;

  res.status(200).json({
    service: 'MoM Bot Transcript Service',
    version: '1.0.0',
    description: 'Automated meeting transcript fetcher for Microsoft Teams',
    authentication: {
      status: isAuthenticated ? 'Logged in' : 'Not logged in',
      loginUrl: '/auth/login',
    },
    endpoints: {
      'GET /': 'API information',
      'GET /health': 'Health check',
      // Auth endpoints
      'GET /auth/login': 'Start OAuth login (redirects to Microsoft)',
      'GET /auth/callback': 'OAuth callback (handled automatically)',
      'GET /auth/status': 'Check authentication status',
      'GET /auth/test': 'Test your Graph API connection',
      'GET /auth/logout': 'Logout and clear session',
      // Webhook endpoints
      'GET /webhook': 'Webhook validation',
      'POST /webhook': 'Webhook notifications',
      // Transcript endpoints
      'POST /transcript/fetch': 'Manual transcript fetch',
      'POST /transcript/:meetingId': 'Fetch transcript by meeting ID',
      // Test endpoints
      'GET /test/connection': 'Test Graph API connection (app credentials)',
    },
    quickStart: {
      step1: 'Visit /auth/login to authenticate with Microsoft',
      step2: 'After login, check /auth/status to confirm',
      step3: 'Use POST /transcript/fetch to get meeting transcripts',
    },
  });
});

/**
 * Serve static files from frontend build
 */
const publicPath = path.join(__dirname, 'public');
app.use(express.static(publicPath));

/**
 * Error handling middleware
 */
app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
  logger.error('Unhandled error:', err);

  res.status(500).json({
    error: 'Internal server error',
    message: err.message,
  });
});

/**
 * Catch-all: Serve React app for any unmatched routes
 * This enables client-side routing in the React SPA
 */
app.use((req: Request, res: Response) => {
  // Check if it's an API request that wasn't matched
  if (req.path.startsWith('/api/') || req.path.startsWith('/auth/') ||
    req.path.startsWith('/webhook') || req.path.startsWith('/transcript/') ||
    req.path.startsWith('/meetings') || req.path.startsWith('/health') ||
    req.path.startsWith('/test/')) {
    res.status(404).json({
      error: 'Not found',
      message: `Route ${req.method} ${req.path} not found`,
    });
  } else {
    // Serve React app for client-side routing
    const indexPath = path.join(publicPath, 'index.html');
    res.sendFile(indexPath, (err) => {
      if (err) {
        res.status(404).json({
          error: 'Frontend not built',
          message: 'Run "npm run build:frontend" to build the frontend',
        });
      }
    });
  }
});

/**
 * Start the server
 */
async function startServer() {
  try {
    // Validate configuration
    logger.info('🚀 Starting MoM Bot Transcript Service...');
    logger.info('');
    validateConfig();

    // Start Express server
    const port = config.server.port;
    app.listen(port, () => {
      logger.info('');
      logger.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      logger.info(`✅ Server running on port ${port}`);
      logger.info(`   Environment: ${config.server.nodeEnv}`);
      logger.info('');
      logger.info('🔐 OAuth Authentication (Delegated Permissions):');
      logger.info(`   Login:    http://localhost:${port}/auth/login`);
      logger.info(`   Status:   http://localhost:${port}/auth/status`);
      logger.info(`   Logout:   http://localhost:${port}/auth/logout`);
      logger.info('');
      logger.info('📡 API Endpoints:');
      logger.info(`   Info:     http://localhost:${port}/`);
      logger.info(`   Health:   http://localhost:${port}/health`);
      logger.info(`   Webhook:  http://localhost:${port}/webhook`);
      logger.info(`   Fetch:    http://localhost:${port}/transcript/fetch`);
      logger.info('');
      logger.info('🚀 Quick Start:');
      logger.info('   1. Visit /auth/login to authenticate with Microsoft');
      logger.info('   2. Check /auth/status to confirm you are logged in');
      logger.info('   3. POST to /transcript/fetch to get transcripts');
      logger.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      logger.info('');
    });
  } catch (error) {
    logger.error('Failed to start server', error);
    process.exit(1);
  }
}

// Handle graceful shutdown
process.on('SIGINT', () => {
  logger.info('');
  logger.info('Shutting down gracefully...');
  process.exit(0);
});

process.on('SIGTERM', () => {
  logger.info('');
  logger.info('Shutting down gracefully...');
  process.exit(0);
});

// Start the server
startServer();
