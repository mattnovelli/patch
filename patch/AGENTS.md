# AGENTS.md - Pebble Voice-to-Email Messaging System

## Overview

This Pebble smartwatch application is a critical component in a larger workflow that enables text messaging from iOS devices where native text messaging support is not available or feasible. The app converts voice input from the watch into structured emails that are intercepted and processed by an iOS Shortcut to send actual text messages.

## System Architecture

### Components

1. **Pebble Watch App (C)** - `src/c/main.c`
   - Displays contact list via menu interface
   - Captures voice input using Pebble's dictation API
   - Sends contact selection and transcribed text to companion JavaScript

2. **Pebble JavaScript Companion (PebbleKit JS)** - `src/pkjs/index.js`
   - Manages contact storage and configuration
   - Opens hosted OAuth/config page and consumes returned settings JSON
   - Integrates with Microsoft Graph API for email sending
   - Formats voice messages into structured JSON for iOS processing

3. **Hosted OAuth Receiver (GitHub Pages)** - `../docs/index.html`
   - Handles Microsoft OAuth Authorization Code + PKCE flow
   - Receives callback and exchanges authorization code for tokens
   - Returns settings to Pebble via `pebblejs://close#...`

4. **iOS Shortcut (External Component)**
   - Monitors incoming emails from the Pebble app
   - Parses structured JSON payload from email body
   - Converts email to actual SMS/text message via iOS APIs

## Workflow Process

### 1. Voice Input Capture

```
User selects contact → Voice dictation starts → Text transcription → Send to JS companion
```

### 2. Email Processing

```
JS formats message → Microsoft Graph API call → Email sent → iOS Shortcut triggered
```

### 3. SMS Delivery

```
iOS Shortcut receives email → Parses JSON → Sends SMS → Final delivery
```

## Technical Implementation

### Message Structure

The application sends emails with a specific structure that the iOS Shortcut recognizes:

**Subject:** `NEW TEXT MESSAGE`

**Body (JSON):**

```json
{
  "message": "Transcribed voice message text",
  "recipient": "+15551234567 or person@example.com",
  "name": "Contact Name"
}
```

### Contact Management

- Contacts can be configured dynamically via the watch configuration interface
- Contacts are stored with name and phone number
- Only contact names are displayed on the watch; phone numbers are handled by the iOS Shortcut

### Authentication

- Uses Microsoft Graph OAuth 2.0 authorization code grant flow
- Uses PKCE from a hosted config page (GitHub Pages)
- Supports automatic token refresh when tokens expire
- Tokens are securely managed with expiration tracking
- Implements CSRF protection with state parameters

## Configuration Requirements

### Pebble App Configuration

1. **Microsoft Graph OAuth 2.0**
   - Azure AD app registration with Mail.Send permissions
   - OAuth authorization code grant flow
   - Automatic token refresh capability
   - Required scopes: `Mail.Send`, `offline_access`

2. **Target Email Address**
   - Email address monitored by the iOS Shortcut
   - Typically the user's own email address

3. **Contacts**
   - Contact Name (displayed on watch)
   - Phone Number (used by iOS Shortcut)

### OAuth Setup Requirements

1. **Azure App Registration**
   - Register app in Azure Portal
   - Configure redirect URI to the hosted config page URL
   - Grant Mail.Send and offline_access permissions
   - Note Client ID and Tenant ID

2. **Production Deployment**
   - Host `docs/index.html` on GitHub Pages (or equivalent static HTTPS host)
   - Use the same hosted URL in Azure redirect URI and PKJS `CONFIG_PAGE_URL`
   - OAuth code exchange is handled in the hosted page (no backend required)
   - Tokens are returned to Pebble through `pebblejs://close#...`

### iOS Shortcut Configuration

The iOS Shortcut (not included in this repository) should:

1. Monitor for emails with subject "NEW TEXT MESSAGE"
2. Parse JSON from email body
3. Extract recipient and message
4. Match recipient name to phone number
5. Send SMS using iOS native messaging APIs

## Error Handling

### Watch-Side Errors

- Invalid contact selection
- Empty voice transcription
- Communication failures with JavaScript companion

### JavaScript-Side Errors

- Microsoft Graph OAuth authentication failures
- Token expiration and refresh failures
- Network connectivity issues
- Invalid email formatting
- Missing configuration parameters
- OAuth callback validation errors
- Hosted config page mismatch errors (redirect URI mismatch, wrong pages URL)

### User Feedback

- Vibration patterns for success/failure
- Status messages displayed on watch
- Detailed logging for debugging

## Development Notes

### Build Requirements

- Pebble SDK 3.0+
- Support for all Pebble platforms (Aplite, Basalt, Chalk, Diorite, Emery)
- PebbleKit JavaScript for companion app functionality

### API Dependencies

- Microsoft Graph API v1.0 (Mail.Send)
- Microsoft OAuth 2.0 authorization endpoints
- Pebble Dictation API
- Pebble App Message API

### Security Considerations

- OAuth 2.0 with CSRF protection via state parameters
- Automatic token refresh to minimize exposure
- No client secrets stored (public client flow)
- Access tokens stored locally on phone with expiration tracking
- Email transmission over encrypted HTTPS connections
- No sensitive data stored on watch hardware

## Usage Instructions

### Initial Setup

1. **Register Azure App** (see OAUTH_SETUP.md)
   - Create app registration in Azure Portal
   - Configure OAuth permissions and redirect URI
   - Update OAuth configuration in code with hosted config/receiver URL
2. **Deploy Hosted Config Page**
   - Publish `docs/index.html` to GitHub Pages
   - Verify the same URL is used as Azure redirect URI
3. Install app on Pebble watch
4. Complete OAuth sign-in flow via configuration page
5. Set target email address
6. Add contact names and phone numbers
7. Set up corresponding iOS Shortcut

### Daily Usage

1. Open app on Pebble watch
2. Select contact from menu
3. Speak message when prompted
4. Confirm successful send via watch feedback
5. iOS Shortcut automatically processes email and sends SMS

## Limitations

- Requires active internet connection on paired phone
- Dependent on Microsoft Graph API availability
- Voice recognition accuracy varies with environment
- Requires iOS device with Shortcuts app for SMS conversion

## Future Enhancements

- Alternative email providers (Gmail API, etc.)
- Direct SMS sending (platform permitting)
- Message history and retry functionality
- Better offline handling and queuing

## Troubleshooting

### Common Issues

1. **"Authentication failed"** - Complete OAuth sign-in via configuration page
2. **"Token expired"** - App will automatically refresh; re-sign in if needed
3. **"Network error"** - Check phone internet connectivity
4. **"Invalid contact"** - Verify contact list configuration
5. **"Email failed"** - Check Microsoft Graph API limits and permissions
6. **"OAuth callback failed"** - Verify redirect URI configuration in Azure

### Debugging

- Enable verbose logging in JavaScript console
- Monitor OAuth flow in browser developer tools
- Test Microsoft Graph API access independently
- Verify Azure app registration configuration
- Check iOS Shortcut email monitoring

## Integration Points

This application is designed to integrate with:

- **iOS Shortcuts App** - For email-to-SMS conversion
- **Microsoft Graph API** - For email sending
- **Pebble Companion Apps** - For configuration and communication

The modular design allows for future integration with other platforms and messaging services while maintaining the core voice-to-message functionality.
