# Webhook Subscription Setup Guide

This guide explains how to register a webhook subscription with Microsoft Graph API to receive notifications when Teams meetings end.

## Prerequisites

1. ✅ Azure AD app registered with admin consent granted
2. ✅ Real credentials in `.env` file (not dummy values)
3. ✅ Service running and accessible from the internet
4. ✅ Valid HTTPS endpoint (use ngrok for local testing)

## Step 1: Get Access Token

First, obtain an access token:

```bash
curl -X POST \
  https://login.microsoftonline.com/{TENANT_ID}/oauth2/v2.0/token \
  -H 'Content-Type: application/x-www-form-urlencoded' \
  -d 'grant_type=client_credentials' \
  -d 'client_id={CLIENT_ID}' \
  -d 'client_secret={CLIENT_SECRET}' \
  -d 'scope=https://graph.microsoft.com/.default'
```

Response:
```json
{
  "token_type": "Bearer",
  "expires_in": 3599,
  "access_token": "eyJ0eXAiOiJKV1QiLCJhb..."
}
```

Save the `access_token` for the next step.

## Step 2: Expose Your Local Server (if testing locally)

### Using ngrok

```bash
# Install ngrok
brew install ngrok  # macOS
# or download from https://ngrok.com

# Start your service
npm run dev

# In another terminal, expose port 3000
ngrok http 3000

# Copy the HTTPS URL (e.g., https://abc123.ngrok.io)
```

Your webhook URL will be: `https://abc123.ngrok.io/webhook`

## Step 3: Register Webhook Subscription

Create a subscription for online meeting updates:

```bash
curl -X POST \
  https://graph.microsoft.com/v1.0/subscriptions \
  -H 'Authorization: Bearer {ACCESS_TOKEN}' \
  -H 'Content-Type: application/json' \
  -d '{
    "changeType": "updated",
    "notificationUrl": "https://your-server.com/webhook",
    "resource": "/communications/onlineMeetings",
    "expirationDateTime": "2026-02-11T00:00:00Z",
    "clientState": "my-secret-state"
  }'
```

**Important fields:**
- `changeType`: Type of change to monitor (`created`, `updated`, `deleted`)
- `notificationUrl`: Your webhook endpoint (must be HTTPS)
- `resource`: The resource to monitor (online meetings)
- `expirationDateTime`: When subscription expires (max 3 days for meetings)
- `clientState`: Secret value to verify notifications are from Graph API

Response (success):
```json
{
  "@odata.context": "https://graph.microsoft.com/v1.0/$metadata#subscriptions/$entity",
  "id": "7f105c7d-2dc5-4530-97cd-4e7ae6534c07",
  "resource": "/communications/onlineMeetings",
  "changeType": "updated",
  "clientState": "my-secret-state",
  "notificationUrl": "https://your-server.com/webhook",
  "expirationDateTime": "2026-02-11T00:00:00.0000000Z",
  "creatorId": "your-app-id"
}
```

## Step 4: Webhook Validation

When you create the subscription, Graph API will send a validation request to your webhook:

```
GET https://your-server.com/webhook?validationToken=abc123xyz
```

Your service automatically handles this by echoing back the token. Check your logs:

```
[INFO] Webhook validation request received
[INFO] ✅ Webhook validation successful
```

## Step 5: Test with a Meeting

1. Schedule a Teams meeting
2. Enable transcription during the meeting
3. Speak some content
4. End the meeting
5. Wait 2-5 minutes for transcript processing
6. Check your service logs for notifications

Expected log output:
```
[INFO] Received 1 webhook notification(s)
[INFO] Processing notification...
[INFO] Meeting update detected - attempting to fetch transcript...
[INFO] Waiting 30 seconds for transcript processing...
[INFO] Fetching meeting info for {meetingId}...
[INFO] ✅ Meeting info retrieved: "Daily Standup"
[INFO] Listing transcripts for meeting...
[INFO] Found 1 transcript(s)
[INFO] Fetching transcript content...
[INFO] ✅ Transcript content retrieved
[INFO] Parsing VTT transcript...
[INFO] ✅ Parsed 15 transcript entries
[INFO] ✅ Successfully fetched and parsed transcript
```

## Subscription Management

### List Active Subscriptions

```bash
curl -X GET \
  https://graph.microsoft.com/v1.0/subscriptions \
  -H 'Authorization: Bearer {ACCESS_TOKEN}'
```

### Renew Subscription (before expiration)

```bash
curl -X PATCH \
  https://graph.microsoft.com/v1.0/subscriptions/{SUBSCRIPTION_ID} \
  -H 'Authorization: Bearer {ACCESS_TOKEN}' \
  -H 'Content-Type: application/json' \
  -d '{
    "expirationDateTime": "2026-02-14T00:00:00Z"
  }'
```

### Delete Subscription

```bash
curl -X DELETE \
  https://graph.microsoft.com/v1.0/subscriptions/{SUBSCRIPTION_ID} \
  -H 'Authorization: Bearer {ACCESS_TOKEN}'
```

## Troubleshooting

### "Subscription validation failed"

- Ensure your webhook endpoint is publicly accessible
- Check that your service is running
- Verify the URL is HTTPS (not HTTP)
- Check service logs for validation requests

### "No notifications received"

- Verify the subscription is active: `GET /subscriptions`
- Check subscription hasn't expired
- Ensure meetings have transcription enabled
- Check firewall/network settings

### "Transcript not available"

- Meeting just ended (wait 2-5 minutes)
- Transcription wasn't enabled during meeting
- You don't have permissions to access transcript

## Important Notes

1. **Subscription expiration**: Online meeting subscriptions expire after max 3 days. Implement renewal logic in production.

2. **Security**: Always validate `clientState` in notifications to ensure they're from Graph API.

3. **Rate limits**: Graph API has rate limits. Don't create too many subscriptions.

4. **HTTPS required**: Graph API only sends notifications to HTTPS endpoints.

5. **Public accessibility**: Your webhook must be accessible from the internet (Microsoft's servers need to reach it).

## Alternative: Manual Trigger (for testing)

Instead of webhooks, you can manually trigger transcript fetching:

```bash
curl -X POST \
  http://localhost:3000/transcript/fetch \
  -H 'Content-Type: application/json' \
  -d '{
    "meetingId": "your-meeting-id",
    "organizerId": "organizer-user-id"
  }'
```

This is useful for:
- Testing without webhook setup
- Fetching historical meeting transcripts
- Debugging issues

## Resources

- [Microsoft Graph Webhooks Documentation](https://learn.microsoft.com/en-us/graph/webhooks)
- [Online Meetings API Reference](https://learn.microsoft.com/en-us/graph/api/resources/onlinemeeting)
- [Subscription Resource Type](https://learn.microsoft.com/en-us/graph/api/resources/subscription)
