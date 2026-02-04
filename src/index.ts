import express, { Request, Response, NextFunction } from 'express';
import { config, validateConfig } from './config/config';
import { logger } from './utils/logger';
import { testGraphConnection } from './services/graphClient';
import {
  handleWebhookValidation,
  handleWebhookNotification,
  handleManualTrigger,
} from './services/webhookHandler';

// Initialize Express app
const app = express();

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

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

/**
 * Manual trigger endpoint for testing
 * POST /transcript/fetch
 * Body: { meetingId: string, organizerId: string }
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
  res.status(200).json({
    service: 'MoM Bot Transcript Service',
    version: '1.0.0',
    description: 'Automated meeting transcript fetcher for Microsoft Teams',
    endpoints: {
      'GET /': 'API information',
      'GET /health': 'Health check',
      'GET /webhook': 'Webhook validation',
      'POST /webhook': 'Webhook notifications',
      'POST /transcript/fetch': 'Manual transcript fetch',
      'POST /transcript/:meetingId': 'Fetch transcript by meeting ID',
      'GET /test/connection': 'Test Graph API connection',
    },
    documentation: {
      'Manual trigger example': {
        method: 'POST',
        endpoint: '/transcript/fetch',
        body: {
          meetingId: 'your-meeting-id',
          organizerId: 'organizer-user-id',
        },
      },
    },
  });
});

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
 * 404 handler
 */
app.use((req: Request, res: Response) => {
  res.status(404).json({
    error: 'Not found',
    message: `Route ${req.method} ${req.path} not found`,
  });
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
      logger.info('📡 Available endpoints:');
      logger.info(`   http://localhost:${port}/`);
      logger.info(`   http://localhost:${port}/health`);
      logger.info(`   http://localhost:${port}/webhook`);
      logger.info(`   http://localhost:${port}/transcript/fetch`);
      logger.info(`   http://localhost:${port}/test/connection`);
      logger.info('');
      logger.info('🔧 Next steps:');
      logger.info('   1. Get real Azure AD credentials from IT');
      logger.info('   2. Update .env file with real credentials');
      logger.info('   3. Register webhook subscription with Microsoft Graph');
      logger.info('   4. Test with a real Teams meeting');
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
