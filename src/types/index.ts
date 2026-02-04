/**
 * Main transcript data structure that will be passed to the LLM service
 */
export interface TranscriptData {
  meetingId: string;
  meetingTitle: string;
  meetingType: 'daily' | 'tech-refinement' | 'product-refinement' | 'other';
  date: string; // ISO 8601 format
  duration: number; // in minutes
  attendees: Array<{
    name: string;
    email: string;
  }>;
  transcript: Array<{
    timestamp: string;
    speaker: string;
    text: string;
  }>;
}

/**
 * Microsoft Graph webhook notification payload
 */
export interface WebhookNotification {
  subscriptionId: string;
  changeType: string;
  clientState?: string;
  resource: string;
  resourceData: {
    '@odata.type': string;
    '@odata.id': string;
    id: string;
  };
}

/**
 * Webhook validation request from Microsoft Graph
 */
export interface WebhookValidationRequest {
  validationToken: string;
}

/**
 * Meeting information from Graph API
 */
export interface MeetingInfo {
  id: string;
  subject: string;
  startDateTime: string;
  endDateTime: string;
  participants: {
    attendees: Array<{
      emailAddress: {
        name: string;
        address: string;
      };
    }>;
  };
}

/**
 * Transcript metadata from Graph API
 */
export interface TranscriptMetadata {
  id: string;
  createdDateTime: string;
  meetingOrganizerId: string;
}

/**
 * Error response structure
 */
export interface ErrorResponse {
  error: string;
  message: string;
  code?: string;
}
