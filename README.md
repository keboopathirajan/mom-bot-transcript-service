# MoM Bot - Transcript Service

Automated meeting transcript fetcher for Microsoft Teams. Part of the MoM Bot hackathon project.

## Overview

This service:
1. Receives webhook notifications when Teams meetings end
2. Fetches meeting transcripts via Microsoft Graph API
3. Parses VTT format transcripts to structured JSON
4. Outputs `TranscriptData` for the LLM service to process

## Project Structure

```
mom-bot-transcript-service/
├── src/
│   ├── index.ts              # Express server, main entry point
│   ├── config/
│   │   └── config.ts         # Environment configuration
│   ├── services/
│   │   ├── graphClient.ts    # Azure AD authentication
│   │   ├── webhookHandler.ts # Process webhook notifications
│   │   ├── transcriptFetcher.ts # Fetch transcripts from Graph API
│   │   └── vttParser.ts      # Parse VTT to structured format
│   ├── types/
│   │   └── index.ts          # TypeScript interfaces
│   └── utils/
│       └── logger.ts         # Logging utility
├── .env                      # Environment variables (not committed)
├── .env.example              # Example environment variables
├── package.json
├── tsconfig.json
└── README.md
```

## Setup

### 1. Install Dependencies

```bash
npm install
```

### 2. Configure Environment Variables

Copy `.env.example` to `.env`:

```bash
cp .env.example .env
```

Update `.env` with your Azure AD credentials once you receive them:

```env
TENANT_ID=your-tenant-id
CLIENT_ID=your-client-id
CLIENT_SECRET=your-client-secret
PORT=3000
NODE_ENV=development
```

### 3. Build the Project

```bash
npm run build
```

## Running the Service

### Development Mode (with auto-reload)

```bash
npm run dev
```

### Production Mode

```bash
npm run build
npm start
```

The server will start on `http://localhost:3000` (or the port specified in `.env`).

## API Endpoints

### Health Check
```
GET /health
```

Response:
```json
{
  "status": "ok",
  "service": "MoM Bot Transcript Service",
  "timestamp": "2026-02-04T10:00:00.000Z"
}
```

### Webhook (for Graph API subscriptions)
```
GET /webhook?validationToken=<token>  # Validation
POST /webhook                          # Receive notifications
```

### Manual Transcript Fetch
```
POST /transcript/fetch
Content-Type: application/json

{
  "meetingId": "your-meeting-id",
  "organizerId": "organizer-user-id"
}
```

Response:
```json
{
  "success": true,
  "message": "Transcript fetched successfully",
  "data": {
    "meetingId": "...",
    "meetingTitle": "Daily Standup",
    "meetingType": "daily",
    "date": "2026-02-04T09:00:00Z",
    "duration": 15,
    "attendees": [...],
    "transcript": [...]
  }
}
```

### Test Graph Connection
```
GET /test/connection
```

## Data Output Format

The service outputs `TranscriptData` in this format:

```typescript
{
  meetingId: string;
  meetingTitle: string;
  meetingType: 'daily' | 'tech-refinement' | 'product-refinement' | 'other';
  date: string; // ISO 8601
  duration: number; // minutes
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
```

## Webhook Subscription Setup

⚠️ **This requires real Azure AD credentials with admin consent**

Once you have credentials, register a webhook subscription:

```bash
POST https://graph.microsoft.com/v1.0/subscriptions
Authorization: Bearer <access-token>
Content-Type: application/json

{
  "changeType": "updated",
  "notificationUrl": "https://your-server.com/webhook",
  "resource": "/communications/onlineMeetings",
  "expirationDateTime": "2026-02-11T00:00:00Z",
  "clientState": "my-secret-state"
}
```

**Note:** Your webhook endpoint must be publicly accessible (use ngrok for local testing).

### Using ngrok for Local Testing

```bash
# Install ngrok
brew install ngrok  # macOS
# or download from https://ngrok.com

# Start your service
npm run dev

# In another terminal, expose the service
ngrok http 3000

# Use the ngrok URL in your subscription
# Example: https://abc123.ngrok.io/webhook
```

## Testing Without Real Credentials

The service is built to work with dummy credentials for development. You can:

1. **Test the VTT parser** with sample VTT files
2. **Test the webhook endpoint** with mock notifications
3. **Build your integration** with Christian's LLM service using mock data

### Example: Test VTT Parser

Create a file `test-transcript.vtt`:

```
WEBVTT

00:00:05.000 --> 00:00:10.000
<v John Smith>Good morning everyone, let's start the daily standup.</v>

00:00:10.500 --> 00:00:18.000
<v Sarah Johnson>Yesterday I completed the auth feature. Today I'll work on tests.</v>

00:00:18.500 --> 00:00:25.000
<v Mike Chen>I'm blocked on the API docs, need help from backend team.</v>
```

Then test in code:

```typescript
import { parseVTT } from './src/services/vttParser';
import fs from 'fs';

const vttContent = fs.readFileSync('test-transcript.vtt', 'utf-8');
const parsed = parseVTT(vttContent);
console.log(parsed);
```

## Troubleshooting

### "Authentication failed" error

- Check that your `.env` file has the correct credentials
- Verify that admin consent was granted for the API permissions
- Test with: `GET http://localhost:3000/test/connection`

### "Transcript not available" error

Possible reasons:
1. Transcription wasn't enabled during the meeting
2. Meeting just ended (transcripts take 2-5 minutes to process)
3. You don't have permission to access the transcript

### "Meeting not found" error

- Check that the `meetingId` and `organizerId` are correct
- Verify that the meeting exists in the organizer's calendar

## Next Steps

1. ✅ Service is built and ready
2. ⏳ Waiting for Azure AD credentials from IT
3. ⏳ Once credentials are received:
   - Update `.env` file
   - Test connection: `GET /test/connection`
   - Register webhook subscription
   - Test with a real meeting
4. ⏳ Integrate with Christian's LLM service
5. ⏳ Connect to Saheb's publishing service

## Team

- **Transcript Service** (You): Fetch and parse transcripts
- **LLM Service** (Christian): Generate meeting minutes
- **Publishing Service** (Saheb): Post to Confluence and Slack
- **Access & Infra** (Rodrigo): Azure AD setup and deployment

## Resources

- [Microsoft Graph API - Online Meetings](https://learn.microsoft.com/en-us/graph/api/resources/onlinemeeting)
- [Microsoft Graph API - Transcripts](https://learn.microsoft.com/en-us/graph/api/resources/calltranscript)
- [Webhooks with Microsoft Graph](https://learn.microsoft.com/en-us/graph/webhooks)
- [Slack Channel](Link to #hackathon-mom-bot)

## License

ISC - Hackathon Project
