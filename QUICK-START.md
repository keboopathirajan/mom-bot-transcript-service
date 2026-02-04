# Quick Start Guide

Get the MoM Bot Transcript Service up and running in minutes!

## Installation

```bash
cd ~/Desktop/mom-bot-transcript-service
npm install
```

## Development

```bash
# Start in development mode with auto-reload
npm run dev
```

The server will start on `http://localhost:3000`

You'll see:

```
⚠️  Warning: Using dummy credentials. The following environment variables need real values:
   TENANT_ID, CLIENT_ID, CLIENT_SECRET
   Set these in your .env file once you receive credentials from IT.

✅ Server running on port 3000
```

## Test the Service

### 1. Check Health

```bash
curl http://localhost:3000/health
```

### 2. Test VTT Parser

```bash
node test-vtt-parser.js
```

This will parse the sample transcript in `mock-data/sample-transcript.vtt` and show the output.

### 3. View API Endpoints

```bash
curl http://localhost:3000/
```

## What Works Now (Without Real Credentials)

✅ **VTT Parser** - Parse WebVTT transcripts to structured JSON
✅ **API Endpoints** - All endpoints are set up and functional
✅ **Mock Data** - Test with sample transcripts
✅ **Type Definitions** - Share `TranscriptData` interface with team

## What Needs Real Credentials

⏳ **Graph API Connection** - Fetch actual meeting transcripts
⏳ **Webhook Notifications** - Receive meeting end events
⏳ **Authentication** - Azure AD access token

## Share with Your Team

### For Christian (LLM Service)

The `TranscriptData` interface your service outputs:

```typescript
interface TranscriptData {
  meetingId: string;
  meetingTitle: string;
  meetingType: 'daily' | 'tech-refinement' | 'product-refinement' | 'other';
  date: string; // ISO 8601
  duration: number; // minutes
  attendees: Array<{ name: string; email: string }>;
  transcript: Array<{
    timestamp: string;
    speaker: string;
    text: string;
  }>;
}
```

**Mock data for testing:** `mock-data/sample-transcript-data.json`

### For Saheb (Publishing Service)

Christian's LLM service will output `MeetingMinutes` which you'll publish to Confluence/Slack.

### For Rodrigo (Access & Infra)

**Still needed:**

- Azure AD Application Developer access
- Admin consent for API permissions
- Real credentials: TENANT_ID, CLIENT_ID, CLIENT_SECRET

## Next Steps

1. ✅ **Service is ready** - All code is implemented
2. ⏳ **Waiting for Azure credentials** - Check JIRA ticket status
3. ⏳ **Once credentials received:**
  - Update `.env` file
  - Test: `curl http://localhost:3000/test/connection`
  - Register webhook (see `WEBHOOK-SETUP.md`)
  - Test with real meeting

## Project Structure

```
mom-bot-transcript-service/
├── src/                      # Source code
│   ├── index.ts              # Express server
│   ├── config/               # Configuration
│   ├── services/             # Core services
│   │   ├── graphClient.ts    # Azure AD auth
│   │   ├── webhookHandler.ts # Webhook processing
│   │   ├── transcriptFetcher.ts # Fetch transcripts
│   │   └── vttParser.ts      # Parse VTT format
│   ├── types/                # TypeScript interfaces
│   └── utils/                # Utilities
├── dist/                     # Compiled JavaScript
├── mock-data/                # Sample data for testing
├── .env                      # Environment variables
├── README.md                 # Full documentation
├── WEBHOOK-SETUP.md          # Webhook guide
└── test-vtt-parser.js        # Test script
```

## Troubleshooting

### Port already in use

```bash
# Find and kill process on port 3000
lsof -ti:3000 | xargs kill -9

# Or use a different port
PORT=3001 npm run dev
```

### TypeScript errors

```bash
# Rebuild
npm run build
```

### Dependencies issues

```bash
# Clean install
rm -rf node_modules package-lock.json
npm install
```

## Documentation

- **README.md** - Complete documentation
- **WEBHOOK-SETUP.md** - Webhook subscription guide
- **QUICK-START.md** - This file

## Support

Questions? Ask in Slack: `#hackathon-mom-bot`