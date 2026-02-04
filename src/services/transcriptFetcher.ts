import { getGraphClient } from './graphClient';
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

    // Build the TranscriptData object
    const transcriptData: TranscriptData = {
      meetingId,
      meetingTitle: meetingInfo.subject,
      meetingType: determineMeetingType(meetingInfo.subject),
      date: meetingInfo.startDateTime,
      duration: calculateDuration(meetingInfo.startDateTime, meetingInfo.endDateTime),
      attendees: (meetingInfo.participants?.attendees || []).map(attendee => ({
        name: attendee.emailAddress.name,
        email: attendee.emailAddress.address,
      })),
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
