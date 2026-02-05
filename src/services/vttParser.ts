import { logger } from '../utils/logger';

/**
 * Parsed transcript entry
 */
export interface ParsedTranscriptEntry {
  timestamp: string;
  speaker: string;
  text: string;
}

/**
 * Parse WebVTT (Web Video Text Tracks) format to structured transcript
 *
 * VTT format example:
 * WEBVTT
 *
 * 00:00:05.000 --> 00:00:10.000
 * <v John Smith>Good morning everyone, let's start the daily standup.</v>
 *
 * 00:00:10.500 --> 00:00:18.000
 * <v Sarah Johnson>I worked on the authentication feature yesterday.</v>
 */
export function parseVTT(vttContent: string): ParsedTranscriptEntry[] {
  try {
    logger.info('[DEBUG] Parsing VTT transcript...');
    logger.info(`[DEBUG] VTT content type: ${typeof vttContent}`);
    logger.info(`[DEBUG] VTT content length: ${vttContent?.length || 'N/A'}`);
    
    // Handle case where content might be an object (JSON response)
    if (typeof vttContent === 'object') {
      logger.info(`[DEBUG] Content is object, stringifying: ${JSON.stringify(vttContent).substring(0, 500)}`);
      vttContent = JSON.stringify(vttContent);
    }
    
    // Ensure we have a string
    if (typeof vttContent !== 'string') {
      logger.info(`[DEBUG] Converting to string from: ${typeof vttContent}`);
      vttContent = String(vttContent);
    }
    
    logger.info(`[DEBUG] First 500 chars of VTT: ${vttContent.substring(0, 500)}`);

    const entries: ParsedTranscriptEntry[] = [];

    // Split into lines and remove empty lines
    const lines = vttContent
      .split('\n')
      .map(line => line.trim())
      .filter(line => line.length > 0);
    
    logger.info(`[DEBUG] Total lines after split: ${lines.length}`);
    logger.info(`[DEBUG] First 5 lines: ${JSON.stringify(lines.slice(0, 5))}`);

    // Skip the first line (WEBVTT header)
    let i = lines[0] === 'WEBVTT' ? 1 : 0;

    while (i < lines.length) {
      const line = lines[i];

      // Check if this line is a timestamp (contains -->)
      if (line.includes('-->')) {
        const timestampMatch = line.match(/^([\d:\.]+)\s+-->\s+([\d:\.]+)$/);

        if (timestampMatch && i + 1 < lines.length) {
          const startTime = timestampMatch[1];
          const textLine = lines[i + 1];

          // Extract speaker and text from the format: <v Speaker Name>Text</v>
          const speakerMatch = textLine.match(/<v\s+([^>]+)>([^<]*)<\/v>/);

          if (speakerMatch) {
            const speaker = speakerMatch[1].trim();
            const text = speakerMatch[2].trim();

            entries.push({
              timestamp: startTime,
              speaker,
              text,
            });
          } else {
            // Fallback: text without speaker tags
            entries.push({
              timestamp: startTime,
              speaker: 'Unknown',
              text: textLine,
            });
          }

          i += 2; // Skip timestamp and text line
        } else {
          i++;
        }
      } else {
        i++;
      }
    }

    logger.info(`✅ Parsed ${entries.length} transcript entries`);
    return entries;
  } catch (error) {
    logger.error('❌ Failed to parse VTT transcript', error);
    throw new Error('Failed to parse transcript. The VTT format may be malformed.');
  }
}

/**
 * Format timestamp from seconds to MM:SS format
 */
export function formatTimestamp(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

/**
 * Parse timestamp string (HH:MM:SS.mmm) to seconds
 */
export function parseTimestampToSeconds(timestamp: string): number {
  const parts = timestamp.split(':');

  if (parts.length === 3) {
    const hours = parseInt(parts[0], 10);
    const minutes = parseInt(parts[1], 10);
    const seconds = parseFloat(parts[2]);
    return hours * 3600 + minutes * 60 + seconds;
  } else if (parts.length === 2) {
    const minutes = parseInt(parts[0], 10);
    const seconds = parseFloat(parts[1]);
    return minutes * 60 + seconds;
  }

  return 0;
}

/**
 * Group transcript entries by speaker for better readability
 */
export function groupBySpeaker(entries: ParsedTranscriptEntry[]): Array<{
  speaker: string;
  statements: string[];
}> {
  const grouped: { [speaker: string]: string[] } = {};

  entries.forEach(entry => {
    if (!grouped[entry.speaker]) {
      grouped[entry.speaker] = [];
    }
    grouped[entry.speaker].push(entry.text);
  });

  return Object.entries(grouped).map(([speaker, statements]) => ({
    speaker,
    statements,
  }));
}
