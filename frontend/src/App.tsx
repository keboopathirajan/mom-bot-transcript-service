import { useState, useEffect } from 'react';
import {
  Container,
  Box,
  Typography,
  TextField,
  Button,
  Paper,
  CircularProgress,
  Alert,
  Chip,
  Divider,
  List,
  ListItem,
  ListItemText,
  Avatar,
  Card,
  CardContent,
} from '@mui/material';
import {
  Login as LoginIcon,
  Logout as LogoutIcon,
  ContentPaste as PasteIcon,
  Download as DownloadIcon,
  Person as PersonIcon,
  AccessTime as TimeIcon,
  Groups as GroupsIcon,
} from '@mui/icons-material';

// API base URL - use Render backend for both dev and prod
// This ensures OAuth works since redirect URI is configured for Render
const API_BASE_URL = import.meta.env.PROD
  ? '' // Same origin in production (backend serves frontend)
  : 'https://mom-bot-transcript-service.onrender.com'; // Render backend for local dev

interface AuthStatus {
  authenticated: boolean;
  user?: {
    email: string;
    id: string;
  };
  message?: string;
}

interface TranscriptEntry {
  timestamp: string;
  speaker: string;
  text: string;
}

interface TranscriptData {
  meetingId: string;
  meetingTitle: string;
  meetingType: string;
  date: string;
  duration: number;
  attendees: { name: string; email: string }[];
  transcript: TranscriptEntry[];
}

function App() {
  const [authStatus, setAuthStatus] = useState<AuthStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [meetingUrl, setMeetingUrl] = useState('');
  const [fetching, setFetching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [transcriptData, setTranscriptData] = useState<TranscriptData | null>(null);

  // Check auth status on load
  useEffect(() => {
    checkAuthStatus();
  }, []);

  const checkAuthStatus = async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/auth/status`, {
        credentials: 'include',
      });
      const data = await response.json();
      setAuthStatus(data);
    } catch (err) {
      setAuthStatus({ authenticated: false });
    } finally {
      setLoading(false);
    }
  };

  const handleLogin = () => {
    // Always redirect to Render backend for OAuth
    window.location.href = `${API_BASE_URL}/auth/login`;
  };

  const handleLogout = async () => {
    try {
      await fetch(`${API_BASE_URL}/auth/logout`, { credentials: 'include' });
      setAuthStatus({ authenticated: false });
      setTranscriptData(null);
    } catch (err) {
      console.error('Logout failed:', err);
    }
  };

  const handleFetchTranscript = async () => {
    if (!meetingUrl.trim()) {
      setError('Please enter a Teams meeting URL');
      return;
    }

    setFetching(true);
    setError(null);
    setTranscriptData(null);

    try {
      const response = await fetch(`${API_BASE_URL}/transcript/fetch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ joinUrl: meetingUrl.trim() }),
      });

      const data = await response.json();

      if (data.success) {
        setTranscriptData(data.data);
        console.log('Transcript Data:', data.data);
      } else {
        setError(data.message || 'Failed to fetch transcript');
      }
    } catch (err: any) {
      setError(err.message || 'An error occurred');
    } finally {
      setFetching(false);
    }
  };

  const handlePaste = async () => {
    try {
      const text = await navigator.clipboard.readText();
      setMeetingUrl(text);
    } catch (err) {
      console.error('Failed to paste:', err);
    }
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  if (loading) {
    return (
      <Box
        sx={{
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Box
      sx={{
        minHeight: '100vh',
        background: 'linear-gradient(135deg, #0f172a 0%, #1e1b4b 100%)',
        py: 4,
      }}
    >
      <Container maxWidth="md">
        {/* Header */}
        <Box sx={{ textAlign: 'center', mb: 4 }}>
          <Typography
            variant="h4"
            sx={{
              background: 'linear-gradient(90deg, #6366f1, #22d3ee)',
              backgroundClip: 'text',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
              mb: 1,
            }}
          >
            MoM Bot
          </Typography>
          <Typography variant="body1" color="text.secondary">
            Meeting Transcript Service for Microsoft Teams
          </Typography>
        </Box>

        {/* Auth Status Card */}
        <Paper sx={{ p: 3, mb: 3 }}>
          <Box
            sx={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}
          >
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
              {authStatus?.authenticated ? (
                <>
                  <Avatar sx={{ bgcolor: 'primary.main' }}>
                    <PersonIcon />
                  </Avatar>
                  <Box>
                    <Typography variant="body1" fontWeight={600}>
                      {authStatus.user?.email || 'Logged In'}
                    </Typography>
                    <Chip
                      label="Authenticated"
                      color="success"
                      size="small"
                      sx={{ mt: 0.5 }}
                    />
                  </Box>
                </>
              ) : (
                <>
                  <Avatar sx={{ bgcolor: 'grey.700' }}>
                    <PersonIcon />
                  </Avatar>
                  <Box>
                    <Typography variant="body1" color="text.secondary">
                      Not logged in
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                      Sign in with Microsoft to continue
                    </Typography>
                  </Box>
                </>
              )}
            </Box>

            {authStatus?.authenticated ? (
              <Button
                variant="outlined"
                color="error"
                startIcon={<LogoutIcon />}
                onClick={handleLogout}
              >
                Logout
              </Button>
            ) : (
              <Button
                variant="contained"
                startIcon={<LoginIcon />}
                onClick={handleLogin}
                sx={{
                  background: 'linear-gradient(90deg, #6366f1, #8b5cf6)',
                  '&:hover': {
                    background: 'linear-gradient(90deg, #4f46e5, #7c3aed)',
                  },
                }}
              >
                Login with Microsoft
              </Button>
            )}
          </Box>
        </Paper>

        {/* Main Content */}
        {authStatus?.authenticated && (
          <>
            {/* URL Input */}
            <Paper sx={{ p: 3, mb: 3 }}>
              <Typography variant="h6" sx={{ mb: 2 }}>
                Fetch Meeting Transcript
              </Typography>

              <Box sx={{ display: 'flex', gap: 2, mb: 2 }}>
                <TextField
                  fullWidth
                  placeholder="Paste Teams meeting URL here..."
                  value={meetingUrl}
                  onChange={(e) => setMeetingUrl(e.target.value)}
                  variant="outlined"
                  sx={{
                    '& .MuiOutlinedInput-root': {
                      backgroundColor: 'background.default',
                    },
                  }}
                />
                <Button
                  variant="outlined"
                  onClick={handlePaste}
                  sx={{ minWidth: 'auto', px: 2 }}
                >
                  <PasteIcon />
                </Button>
              </Box>

              <Button
                variant="contained"
                fullWidth
                startIcon={fetching ? <CircularProgress size={20} /> : <DownloadIcon />}
                onClick={handleFetchTranscript}
                disabled={fetching || !meetingUrl.trim()}
                sx={{
                  background: 'linear-gradient(90deg, #6366f1, #8b5cf6)',
                  '&:hover': {
                    background: 'linear-gradient(90deg, #4f46e5, #7c3aed)',
                  },
                  '&:disabled': {
                    background: 'grey.700',
                  },
                }}
              >
                {fetching ? 'Fetching Transcript...' : 'Fetch Transcript'}
              </Button>

              {error && (
                <Alert severity="error" sx={{ mt: 2 }}>
                  {error}
                </Alert>
              )}
            </Paper>

            {/* Transcript Results */}
            {transcriptData && (
              <Paper sx={{ p: 3 }}>
                {/* Meeting Info */}
                <Box sx={{ mb: 3 }}>
                  <Typography variant="h6" sx={{ mb: 2 }}>
                    {transcriptData.meetingTitle}
                  </Typography>

                  <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
                    <Chip
                      icon={<TimeIcon />}
                      label={formatDate(transcriptData.date)}
                      variant="outlined"
                    />
                    <Chip
                      icon={<TimeIcon />}
                      label={`${transcriptData.duration} minutes`}
                      variant="outlined"
                    />
                    <Chip
                      icon={<GroupsIcon />}
                      label={`${transcriptData.attendees.length} attendees`}
                      variant="outlined"
                    />
                    <Chip label={transcriptData.meetingType} color="primary" />
                  </Box>
                </Box>

                <Divider sx={{ my: 2 }} />

                {/* Transcript Content */}
                <Typography variant="h6" sx={{ mb: 2 }}>
                  Transcript ({transcriptData.transcript.length} entries)
                </Typography>

                {transcriptData.transcript.length > 0 ? (
                  <List sx={{ maxHeight: 400, overflow: 'auto' }}>
                    {transcriptData.transcript.map((entry, index) => (
                      <ListItem
                        key={index}
                        sx={{
                          alignItems: 'flex-start',
                          borderLeft: '3px solid',
                          borderColor: 'primary.main',
                          mb: 1,
                          backgroundColor: 'background.default',
                          borderRadius: 1,
                        }}
                      >
                        <ListItemText
                          primary={
                            <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
                              <Typography
                                variant="body2"
                                fontWeight={600}
                                color="primary.main"
                              >
                                {entry.speaker}
                              </Typography>
                              <Typography variant="caption" color="text.secondary">
                                {entry.timestamp}
                              </Typography>
                            </Box>
                          }
                          secondary={entry.text}
                        />
                      </ListItem>
                    ))}
                  </List>
                ) : (
                  <Card sx={{ backgroundColor: 'background.default' }}>
                    <CardContent>
                      <Typography color="text.secondary">
                        No transcript entries found. The meeting may not have had
                        transcription enabled.
                      </Typography>
                    </CardContent>
                  </Card>
                )}
              </Paper>
            )}
          </>
        )}

        {/* Footer */}
        <Box sx={{ textAlign: 'center', mt: 4 }}>
          <Typography variant="body2" color="text.secondary">
            MoM Bot Transcript Service - Hackathon Project
          </Typography>
        </Box>
      </Container>
    </Box>
  );
}

export default App;
