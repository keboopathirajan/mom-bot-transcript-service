import { Client } from '@microsoft/microsoft-graph-client';
import { getGraphClient } from './graphClient';
import { getUserGraphClient } from './authService';
import { parseVTT } from './vttParser';
import { logger } from '../utils/logger';
import { TranscriptData, MeetingInfo, TranscriptMetadata } from '../types';

/**
 * Wait for a specified number of milliseconds
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Determine meeting type based on meeting title
 */
function determineMeetingType(title: string): TranscriptData['meetingType'] {
  const lowerTitle = title.toLowerCase();

  if (lowerTitle.includes('daily') || lowerTitle.includes('standup')) {
    return 'daily';
  } else if (lowerTitle.includes('tech') && lowerTitle.includes('refinement')) {
    return 'tech-refinement';
  } else if (lowerTitle.includes('product') && lowerTitle.includes('refinement')) {
    return 'product-refinement';
  }

  return 'other';
}

/**
 * Calculate meeting duration in minutes
 */
function calculateDuration(startDateTime: string, endDateTime: string): number {
  const start = new Date(startDateTime);
  const end = new Date(endDateTime);
  const durationMs = end.getTime() - start.getTime();
  return Math.round(durationMs / 1000 / 60); // Convert to minutes
}

/**
 * Fetch meeting information from Graph API
 */
async function getMeetingInfo(meetingId: string, organizerId: string): Promise<MeetingInfo> {
  try {
    logger.info(`Fetching meeting info for ${meetingId}...`);
    const client = getGraphClient();

    // Get meeting details
    const meeting = await client
      .api(`/users/${organizerId}/onlineMeetings/${meetingId}`)
      .get();

    logger.info(`✅ Meeting info retrieved: "${meeting.subject}"`);
    return meeting;
  } catch (error: any) {
    if (error.statusCode === 404) {
      logger.error('Meeting not found. Check the meeting ID and organizer ID.');
      throw new Error('Meeting not found');
    }
    logger.error('Failed to fetch meeting info', error);
    throw error;
  }
}

/**
 * List available transcripts for a meeting
 */
async function listTranscripts(
  meetingId: string,
  organizerId: string
): Promise<TranscriptMetadata[]> {
  try {
    logger.info(`Listing transcripts for meeting ${meetingId}...`);
    const client = getGraphClient();

    const response = await client
      .api(`/users/${organizerId}/onlineMeetings/${meetingId}/transcripts`)
      .get();

    const transcripts = response.value || [];
    logger.info(`Found ${transcripts.length} transcript(s)`);

    return transcripts;
  } catch (error: any) {
    if (error.statusCode === 404) {
      logger.warn('No transcripts endpoint found for this meeting');
      return [];
    }
    logger.error('Failed to list transcripts', error);
    throw error;
  }
}

/**
 * Fetch transcript content in VTT format
 */
async function getTranscriptContent(
  meetingId: string,
  organizerId: string,
  transcriptId: string
): Promise<string> {
  try {
    logger.info(`Fetching transcript content (ID: ${transcriptId})...`);
    const client = getGraphClient();

    // Get transcript content in VTT format
    const content = await client
      .api(`/users/${organizerId}/onlineMeetings/${meetingId}/transcripts/${transcriptId}/content`)
      .header('Accept', 'text/vtt')
      .get();

    logger.info('✅ Transcript content retrieved');
    return content;
  } catch (error: any) {
    if (error.statusCode === 404) {
      logger.error('Transcript content not found');
      throw new Error('Transcript content not available');
    }
    logger.error('Failed to fetch transcript content', error);
    throw error;
  }
}

/**
 * Fetch and parse transcript for a meeting
 *
 * @param meetingId - The online meeting ID
 * @param organizerId - The meeting organizer's user ID
 * @param retryAttempts - Number of retry attempts (transcripts take time to process)
 * @param retryDelayMs - Delay between retries in milliseconds
 */
export async function fetchTranscript(
  meetingId: string,
  organizerId: string,
  retryAttempts: number = 3,
  retryDelayMs: number = 10000
): Promise<TranscriptData> {
  logger.info(`Starting transcript fetch for meeting ${meetingId}...`);

  try {
    // First, get meeting information
    const meetingInfo = await getMeetingInfo(meetingId, organizerId);

    // Try to get transcripts with retries (they take time to process)
    let transcripts: TranscriptMetadata[] = [];
    let attempt = 0;

    while (attempt < retryAttempts) {
      transcripts = await listTranscripts(meetingId, organizerId);

      if (transcripts.length > 0) {
        break;
      }

      attempt++;
      if (attempt < retryAttempts) {
        logger.info(`No transcripts yet. Waiting ${retryDelayMs / 1000}s before retry ${attempt + 1}/${retryAttempts}...`);
        await sleep(retryDelayMs);
      }
    }

    if (transcripts.length === 0) {
      throw new Error(
        'Transcript not available. Possible reasons:\n' +
        '1. Transcription was not enabled for this meeting\n' +
        '2. The meeting just ended and transcript is still processing (try again in a few minutes)\n' +
        '3. You do not have permissions to access the transcript'
      );
    }

    // Get the most recent transcript (usually there's only one)
    const latestTranscript = transcripts[0];

    // Fetch transcript content
    const vttContent = await getTranscriptContent(
      meetingId,
      organizerId,
      latestTranscript.id
    );

    // Parse VTT to structured format
    const parsedEntries = parseVTT(vttContent);

    // Build the TranscriptData object with safe attendee mapping
    const attendees = (meetingInfo.participants?.attendees || [])
      .filter((attendee: any) => attendee?.emailAddress)
      .map((attendee: any) => ({
        name: attendee.emailAddress?.name || attendee.emailAddress?.address || 'Unknown',
        email: attendee.emailAddress?.address || 'unknown@email.com',
      }));
    
    const transcriptData: TranscriptData = {
      meetingId,
      meetingTitle: meetingInfo.subject || 'Untitled Meeting',
      meetingType: determineMeetingType(meetingInfo.subject || ''),
      date: meetingInfo.startDateTime || new Date().toISOString(),
      duration: calculateDuration(meetingInfo.startDateTime || '', meetingInfo.endDateTime || ''),
      attendees,
      transcript: parsedEntries,
    };

    logger.info(`✅ Successfully fetched and parsed transcript for "${meetingInfo.subject}"`);
    logger.info(`   Meeting type: ${transcriptData.meetingType}`);
    logger.info(`   Duration: ${transcriptData.duration} minutes`);
    logger.info(`   Attendees: ${transcriptData.attendees.length}`);
    logger.info(`   Transcript entries: ${transcriptData.transcript.length}`);

    return transcriptData;
  } catch (error: any) {
    logger.error('❌ Failed to fetch transcript', error);
    throw error;
  }
}

/**
 * Check if a transcript is available for a meeting (without fetching full content)
 */
export async function isTranscriptAvailable(
  meetingId: string,
  organizerId: string
): Promise<boolean> {
  try {
    const transcripts = await listTranscripts(meetingId, organizerId);
    return transcripts.length > 0;
  } catch (error) {
    return false;
  }
}

// ============================================================
// Delegated Access Functions (User's Own Meetings)
// These use /me/onlineMeetings endpoint with user's access token
// ============================================================

/**
 * Get a meeting by its join URL (delegated permissions)
 * This is the primary way to look up meetings since listing all meetings is not supported
 * 
 * @param accessToken - User's OAuth access token
 * @param joinUrl - The Teams meeting join URL
 * @returns Meeting object with id, subject, etc.
 */
export async function getMeetingByJoinUrl(accessToken: string, joinUrl: string): Promise<any> {
  try {
    logger.info('Looking up meeting by join URL...');
    const client = getUserGraphClient(accessToken);

    // The join URL needs to be properly encoded for the filter
    // Graph API expects: $filter=JoinWebUrl eq 'url'
    const response = await client
      .api('/me/onlineMeetings')
      .filter(`JoinWebUrl eq '${joinUrl}'`)
      .get();

    const meetings = response.value || [];
    
    if (meetings.length === 0) {
      logger.error('No meeting found with this join URL');
      throw new Error('Meeting not found. Make sure you are the organizer of this meeting.');
    }

    const meeting = meetings[0];
    logger.info(`✅ Found meeting: "${meeting.subject}" (ID: ${meeting.id})`);
    
    return meeting;
  } catch (error: any) {
    if (error.message?.includes('Meeting not found')) {
      throw error;
    }
    logger.error('Failed to look up meeting by join URL', error);
    throw new Error(`Failed to look up meeting: ${error.message}`);
  }
}

/**
 * List user's online meetings (delegated permissions)
 * NOTE: This requires a filter - listing all meetings is not supported by Graph API
 * Use getMeetingByJoinUrl() instead for looking up specific meetings
 */
export async function listUserMeetings(accessToken: string): Promise<any[]> {
  try {
    logger.info('Listing user\'s online meetings...');
    const client = getUserGraphClient(accessToken);

    const response = await client
      .api('/me/onlineMeetings')
      .get();

    const meetings = response.value || [];
    logger.info(`Found ${meetings.length} meeting(s)`);

    return meetings;
  } catch (error: any) {
    logger.error('Failed to list user meetings', error);
    throw error;
  }
}

/**
 * Get meeting info using delegated permissions
 */
async function getUserMeetingInfo(
  accessToken: string,
  meetingId: string
): Promise<MeetingInfo> {
  try {
    logger.info(`Fetching meeting info for ${meetingId} (delegated)...`);
    const client = getUserGraphClient(accessToken);

    const meeting = await client
      .api(`/me/onlineMeetings/${meetingId}`)
      .get();

    logger.info(`✅ Meeting info retrieved: "${meeting.subject}"`);
    return meeting;
  } catch (error: any) {
    if (error.statusCode === 404) {
      logger.error('Meeting not found or you do not have access.');
      throw new Error('Meeting not found or access denied');
    }
    logger.error('Failed to fetch meeting info', error);
    throw error;
  }
}

/**
 * List transcripts for a meeting using delegated permissions
 */
async function listUserTranscripts(
  accessToken: string,
  meetingId: string
): Promise<TranscriptMetadata[]> {
  try {
    logger.info(`Listing transcripts for meeting ${meetingId} (delegated)...`);
    const client = getUserGraphClient(accessToken);

    const response = await client
      .api(`/me/onlineMeetings/${meetingId}/transcripts`)
      .get();

    const transcripts = response.value || [];
    logger.info(`Found ${transcripts.length} transcript(s)`);

    return transcripts;
  } catch (error: any) {
    if (error.statusCode === 404) {
      logger.warn('No transcripts found for this meeting');
      return [];
    }
    logger.error('Failed to list transcripts', error);
    throw error;
  }
}

/**
 * Get transcript content using delegated permissions
 */
async function getUserTranscriptContent(
  accessToken: string,
  meetingId: string,
  transcriptId: string
): Promise<string> {
  try {
    logger.info(`Fetching transcript content (ID: ${transcriptId}) (delegated)...`);
    const client = getUserGraphClient(accessToken);

    const content = await client
      .api(`/me/onlineMeetings/${meetingId}/transcripts/${transcriptId}/content`)
      .header('Accept', 'text/vtt')
      .get();

    // DEBUG: Log the raw content to understand its format
    logger.info('✅ Transcript content retrieved');
    logger.info(`[DEBUG] Content type: ${typeof content}`);
    logger.info(`[DEBUG] Content length: ${content?.length || 'N/A'}`);
    logger.info(`[DEBUG] First 500 chars: ${String(content).substring(0, 500)}`);
    logger.info(`[DEBUG] Is Buffer: ${Buffer.isBuffer(content)}`);
    
    // If content is a Buffer, convert to string
    if (Buffer.isBuffer(content)) {
      logger.info('[DEBUG] Converting Buffer to string...');
      return content.toString('utf-8');
    }
    
    return content;
  } catch (error: any) {
    if (error.statusCode === 404) {
      logger.error('Transcript content not found');
      throw new Error('Transcript content not available');
    }
    logger.error('Failed to fetch transcript content', error);
    throw error;
  }
}

/**
 * Fetch transcript using DELEGATED permissions (user's access token)
 * Uses /me/onlineMeetings endpoint - only accesses user's own meetings
 * 
 * @param accessToken - User's OAuth access token
 * @param meetingId - The online meeting ID
 * @param retryAttempts - Number of retry attempts
 * @param retryDelayMs - Delay between retries
 */
export async function fetchUserTranscript(
  accessToken: string,
  meetingId: string,
  retryAttempts: number = 3,
  retryDelayMs: number = 10000
): Promise<TranscriptData> {
  logger.info(`Starting transcript fetch for meeting ${meetingId} (delegated)...`);

  try {
    // Get meeting information
    const meetingInfo = await getUserMeetingInfo(accessToken, meetingId);

    // Try to get transcripts with retries
    let transcripts: TranscriptMetadata[] = [];
    let attempt = 0;

    while (attempt < retryAttempts) {
      transcripts = await listUserTranscripts(accessToken, meetingId);

      if (transcripts.length > 0) {
        break;
      }

      attempt++;
      if (attempt < retryAttempts) {
        logger.info(`No transcripts yet. Waiting ${retryDelayMs / 1000}s before retry ${attempt + 1}/${retryAttempts}...`);
        await sleep(retryDelayMs);
      }
    }

    if (transcripts.length === 0) {
      throw new Error(
        'Transcript not available. Possible reasons:\n' +
        '1. Transcription was not enabled for this meeting\n' +
        '2. The meeting just ended and transcript is still processing\n' +
        '3. You are not the organizer of this meeting'
      );
    }

    // Get the most recent transcript
    const latestTranscript = transcripts[0];

    // Fetch transcript content
    const vttContent = await getUserTranscriptContent(
      accessToken,
      meetingId,
      latestTranscript.id
    );

    // Parse VTT to structured format
    const parsedEntries = parseVTT(vttContent);

    // DEBUG: Log meeting info structure
    logger.info(`[DEBUG] Meeting participants: ${JSON.stringify(meetingInfo.participants || 'none')}`);
    
    // Build the TranscriptData object with safe attendee mapping
    const attendees = (meetingInfo.participants?.attendees || [])
      .filter((attendee: any) => attendee?.emailAddress)
      .map((attendee: any) => ({
        name: attendee.emailAddress?.name || attendee.emailAddress?.address || 'Unknown',
        email: attendee.emailAddress?.address || 'unknown@email.com',
      }));
    
    const transcriptData: TranscriptData = {
      meetingId,
      meetingTitle: meetingInfo.subject || 'Untitled Meeting',
      meetingType: determineMeetingType(meetingInfo.subject || ''),
      date: meetingInfo.startDateTime || new Date().toISOString(),
      duration: calculateDuration(meetingInfo.startDateTime || '', meetingInfo.endDateTime || ''),
      attendees,
      transcript: parsedEntries,
    };

    logger.info(`✅ Successfully fetched transcript for "${meetingInfo.subject}" (delegated)`);
    logger.info(`   Meeting type: ${transcriptData.meetingType}`);
    logger.info(`   Duration: ${transcriptData.duration} minutes`);
    logger.info(`   Attendees: ${transcriptData.attendees.length}`);
    logger.info(`   Transcript entries: ${transcriptData.transcript.length}`);

    return transcriptData;
  } catch (error: any) {
    logger.error('❌ Failed to fetch transcript (delegated)', error);
    throw error;
  }
}
