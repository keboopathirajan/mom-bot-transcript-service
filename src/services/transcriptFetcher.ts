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
    const response = await client
      .api(`/users/${organizerId}/onlineMeetings/${meetingId}/transcripts/${transcriptId}/content`)
      .header('Accept', 'text/vtt')
      .get();

    logger.info('✅ Transcript content retrieved');

    // Handle stream responses (Graph SDK returns ReadableStream for content endpoints)
    let content: string;

    if (typeof response === 'string') {
      content = response;
    } else if (Buffer.isBuffer(response)) {
      content = response.toString('utf-8');
    } else if (response?.getReader) {
      // ReadableStream
      content = await streamToString(response as ReadableStream<Uint8Array>);
    } else if (response?.readable || response?.on) {
      // Node.js stream
      content = await new Promise<string>((resolve, reject) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer) => chunks.push(chunk));
        response.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
        response.on('error', reject);
      });
    } else {
      content = String(response);
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
 * Helper function to consume a ReadableStream and return string content
 */
async function streamToString(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) chunks.push(value);
  }

  // Combine all chunks and decode as UTF-8
  const totalLength = chunks.reduce((acc, chunk) => acc + chunk.length, 0);
  const combined = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.length;
  }

  return new TextDecoder('utf-8').decode(combined);
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

    const response = await client
      .api(`/me/onlineMeetings/${meetingId}/transcripts/${transcriptId}/content`)
      .header('Accept', 'text/vtt')
      .get();

    logger.info('✅ Transcript content retrieved');
    logger.info(`[DEBUG] Response type: ${typeof response}`);
    logger.info(`[DEBUG] Response constructor: ${response?.constructor?.name || 'unknown'}`);

    let content: string;

    // Handle different response types
    if (typeof response === 'string') {
      // Already a string
      content = response;
      logger.info('[DEBUG] Response is already a string');
    } else if (Buffer.isBuffer(response)) {
      // Buffer - convert to string
      content = response.toString('utf-8');
      logger.info('[DEBUG] Converted Buffer to string');
    } else if (response instanceof ReadableStream) {
      // ReadableStream - consume it
      logger.info('[DEBUG] Response is ReadableStream, consuming...');
      content = await streamToString(response);
      logger.info('[DEBUG] Stream consumed successfully');
    } else if (response?.getReader) {
      // Duck-type check for ReadableStream-like object
      logger.info('[DEBUG] Response has getReader, treating as stream...');
      content = await streamToString(response as ReadableStream<Uint8Array>);
      logger.info('[DEBUG] Stream consumed successfully');
    } else if (response?.body instanceof ReadableStream) {
      // Response object with body stream
      logger.info('[DEBUG] Response.body is ReadableStream, consuming...');
      content = await streamToString(response.body);
      logger.info('[DEBUG] Stream consumed successfully');
    } else if (typeof response?.text === 'function') {
      // Response object with text() method
      logger.info('[DEBUG] Response has text() method, calling it...');
      content = await response.text();
      logger.info('[DEBUG] Got text from response');
    } else if (response?.readable || response?.on) {
      // Node.js stream
      logger.info('[DEBUG] Response is Node.js stream, reading...');
      content = await new Promise<string>((resolve, reject) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer) => chunks.push(chunk));
        response.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
        response.on('error', reject);
      });
      logger.info('[DEBUG] Node.js stream read successfully');
    } else {
      // Unknown type - try to stringify
      logger.warn(`[DEBUG] Unknown response type, attempting toString: ${typeof response}`);
      content = String(response);
    }

    logger.info(`[DEBUG] Final content length: ${content.length}`);
    logger.info(`[DEBUG] First 500 chars: ${content.substring(0, 500)}`);

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
