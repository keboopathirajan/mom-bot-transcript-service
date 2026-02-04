import { Request, Response } from 'express';
import { WebhookNotification, WebhookValidationRequest } from '../types';
import { fetchTranscript, fetchUserTranscript, listUserMeetings } from './transcriptFetcher';
import { getValidAccessToken, TokenResponse } from './authService';
import { logger } from '../utils/logger';
import { config } from '../config/config';

// Extend Express Request to include session with tokens
declare module 'express-session' {
  interface SessionData {
    tokens?: TokenResponse;
  }
}

/**
 * Handle webhook validation request from Microsoft Graph
 * When setting up a subscription, Graph sends a validation token that must be echoed back
 */
export function handleWebhookValidation(req: Request, res: Response): void {
  const validationToken = req.query.validationToken as string;

  if (validationToken) {
    logger.info('Webhook validation request received');
    logger.debug('Validation token:', validationToken);

    // Echo back the validation token in plain text
    res.status(200).type('text/plain').send(validationToken);
    logger.info('✅ Webhook validation successful');
  } else {
    logger.warn('Webhook validation request missing token');
    res.status(400).json({ error: 'Missing validation token' });
  }
}

/**
 * Process webhook notification from Microsoft Graph
 * This is called when a meeting is updated or ends
 */
export async function handleWebhookNotification(
  req: Request,
  res: Response
): Promise<void> {
  try {
    const notifications: { value: WebhookNotification[] } = req.body;

    // Validate that we received notifications
    if (!notifications || !notifications.value || notifications.value.length === 0) {
      logger.warn('Received empty webhook notification');
      res.status(400).json({ error: 'Invalid notification payload' });
      return;
    }

    logger.info(`Received ${notifications.value.length} webhook notification(s)`);

    // Respond immediately to Graph API (202 Accepted)
    // We process the notifications asynchronously
    res.status(202).json({ message: 'Notification received' });

    // Process each notification asynchronously
    for (const notification of notifications.value) {
      processNotification(notification).catch(error => {
        logger.error('Error processing notification', error);
      });
    }
  } catch (error) {
    logger.error('Error handling webhook notification', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * Process a single notification
 * Extract meeting details and fetch transcript
 */
async function processNotification(notification: WebhookNotification): Promise<void> {
  try {
    logger.info('Processing notification:', {
      subscriptionId: notification.subscriptionId,
      changeType: notification.changeType,
      resource: notification.resource,
    });

    // Validate client state if configured
    if (config.webhook.clientState && notification.clientState !== config.webhook.clientState) {
      logger.warn('Client state mismatch - possible security issue');
      return;
    }

    // Extract meeting ID from the resource path
    // Resource format: /communications/onlineMeetings/{meetingId}
    // or /users/{userId}/onlineMeetings/{meetingId}
    const resourceParts = notification.resource.split('/');
    const meetingIdIndex = resourceParts.indexOf('onlineMeetings') + 1;

    if (meetingIdIndex === 0 || meetingIdIndex >= resourceParts.length) {
      logger.error('Could not extract meeting ID from resource path:', notification.resource);
      return;
    }

    const meetingId = resourceParts[meetingIdIndex];

    // Try to get organizer ID from resource data
    const organizerId = notification.resourceData['@odata.id']?.split('/users/')[1]?.split('/')[0] || '';

    if (!organizerId) {
      logger.error('Could not extract organizer ID from notification');
      logger.debug('Resource data:', notification.resourceData);
      return;
    }

    logger.info(`Meeting detected: ${meetingId} (Organizer: ${organizerId})`);

    // Check if this is a meeting end event
    // For now, we process all meeting updates
    if (notification.changeType === 'updated' || notification.changeType === 'deleted') {
      logger.info('Meeting update detected - attempting to fetch transcript...');

      // Wait a bit for transcript to be ready (Teams needs time to process)
      logger.info('Waiting 30 seconds for transcript processing...');
      await new Promise(resolve => setTimeout(resolve, 30000));

      // Fetch transcript
      try {
        const transcriptData = await fetchTranscript(meetingId, organizerId);

        logger.info('✅ Transcript successfully fetched and parsed');
        logger.info('Next step: Send this data to LLM service (Christian\'s module)');

        // TODO: Send transcriptData to LLM service
        // For now, just log it
        logger.debug('Transcript data:', JSON.stringify(transcriptData, null, 2));
      } catch (error: any) {
        logger.error(`❌ Failed to fetch transcript: ${error.message}`);
      }
    } else {
      logger.info(`Ignoring change type: ${notification.changeType}`);
    }
  } catch (error) {

    logger.error('Error in processNotification', error);
    throw error;
  }
}

/**
 * Manually trigger transcript fetch (for testing)
 * Supports both delegated (user login) and application permissions
 */
export async function handleManualTrigger(req: Request, res: Response): Promise<void> {
  try {
    const { meetingId, organizerId } = req.body;

    // Check if user is authenticated (delegated permissions)
    if (req.session?.tokens) {
      // Use delegated permissions (user's own meetings)
      if (!meetingId) {
        res.status(400).json({
          error: 'Missing required parameter',
          message: 'meetingId is required',
          note: 'You are authenticated. Use /meetings to list your meetings.',
        });
        return;
      }

      logger.info(`Manual trigger for meeting ${meetingId} (delegated permissions)`);

      // Get valid access token (refresh if needed)
      const tokens = await getValidAccessToken(req.session.tokens);
      req.session.tokens = tokens;

      // Fetch transcript using user's token
      const transcriptData = await fetchUserTranscript(tokens.accessToken, meetingId);

      res.status(200).json({
        success: true,
        message: 'Transcript fetched successfully (using your credentials)',
        authMode: 'delegated',
        data: transcriptData,
      });
    } else {
      // Use application permissions (requires organizerId)
      if (!meetingId || !organizerId) {
        res.status(400).json({
          error: 'Missing required parameters',
          message: 'Both meetingId and organizerId are required (app permissions mode)',
          hint: 'Login at /auth/login to use delegated permissions (no organizerId needed)',
        });
        return;
      }

      logger.info(`Manual trigger for meeting ${meetingId} (app permissions)`);

      // Fetch transcript using app credentials
      const transcriptData = await fetchTranscript(meetingId, organizerId);

      res.status(200).json({
        success: true,
        message: 'Transcript fetched successfully (using app credentials)',
        authMode: 'application',
        data: transcriptData,
      });
    }
  } catch (error: any) {
    logger.error('Manual trigger failed', error);
    res.status(500).json({
      error: 'Failed to fetch transcript',
      message: error.message,
    });
  }
}

/**
 * List user's meetings (delegated permissions only)
 */
export async function handleListMeetings(req: Request, res: Response): Promise<void> {
  try {
    // Check if user is authenticated
    if (!req.session?.tokens) {
      res.status(401).json({
        error: 'Not authenticated',
        message: 'Login at /auth/login to list your meetings',
      });
      return;
    }

    logger.info('Listing user meetings...');

    // Get valid access token
    const tokens = await getValidAccessToken(req.session.tokens);
    req.session.tokens = tokens;

    // List user's meetings
    const meetings = await listUserMeetings(tokens.accessToken);

    res.status(200).json({
      success: true,
      count: meetings.length,
      meetings: meetings.map(m => ({
        id: m.id,
        subject: m.subject,
        startDateTime: m.startDateTime,
        endDateTime: m.endDateTime,
        joinUrl: m.joinUrl,
      })),
    });
  } catch (error: any) {
    logger.error('Failed to list meetings', error);
    res.status(500).json({
      error: 'Failed to list meetings',
      message: error.message,
    });
  }
}
