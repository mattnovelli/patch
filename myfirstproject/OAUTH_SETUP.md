# OAuth 2.0 Setup Guide for Microsoft Graph (PKCE Flow)

This guide explains how to configure Microsoft Graph OAuth 2.0 authentication using the PKCE (Proof Key for Code Exchange) flow, which is perfect for public clients like Pebble apps.

## Why PKCE Flow?

The PKCE flow is ideal for the Pebble Send Message app because:
- ✅ **No server required** - Token exchange happens directly in the client
- ✅ **No client secrets** - Secure for public clients
- ✅ **No callback hosting** - Uses a standard OAuth receiver
- ✅ **Industry standard** - Recommended by OAuth 2.0 security best practices

## Prerequisites

- Azure Active Directory (Entra ID) tenant access
- Microsoft 365 account with Mail.Send permissions
- **No web server needed!** 🎉

## Azure App Registration Setup

### 1. Create App Registration

1. Go to the [Azure Portal](https://portal.azure.com)
2. Navigate to **Azure Active Directory** > **App registrations**
3. Click **New registration**
4. Fill in the details:
   - **Name**: `Pebble Send Message`
   - **Supported account types**: Choose based on your needs:
     - **Accounts in this organizational directory only** (Single tenant)
     - **Accounts in any organizational directory** (Multi-tenant)
     - **Accounts in any organizational directory and personal Microsoft accounts** (Multi-tenant + personal)
   - **Redirect URI**: 
     - Platform: **Single-page application (SPA)**
     - URI: `https://pebble.github.io/oauth-receiver/` (Pebble's hosted OAuth receiver)

> **Important**: Use "Single-page application" platform, not "Web", since we're using PKCE without client secrets.

### 2. Configure API Permissions

1. In your app registration, go to **API permissions**
2. Click **Add a permission**
3. Select **Microsoft Graph** > **Delegated permissions**
4. Add the following permissions:
   - `Mail.Send` - Send mail as a user
   - `User.Read` - Sign in and read user profile (usually added by default)
   - `offline_access` - Maintain access to data you have given it access to (for refresh tokens)
5. Click **Grant admin consent** if you have admin rights

### 3. Get Configuration Values

1. Go to **Overview** tab in your app registration
2. Copy the **Application (client) ID** - this is your `clientId`
3. Copy the **Directory (tenant) ID** - this is your `tenantId` (or use 'common' for multi-tenant)

### 4. Enable Public Client Flow

1. Go to **Authentication** tab in your app registration
2. Scroll down to **Advanced settings**
3. Under **Allow public client flows**, select **Yes**
4. Click **Save**

> This enables the PKCE flow for your application without requiring client secrets.

## Code Configuration

### Update OAuth Configuration

Edit `/src/pkjs/index.js` and update the OAuth configuration:

```javascript
var OAUTH_CONFIG = {
  clientId: '8df3d150-f5eb-46f2-881d-c061d6b22058',          // From Azure app registration
  tenantId: '2f2b4f0c-fa12-4d9c-9d8f-a03aeb6c4069',                       // Use 'common' for multi-tenant, or your specific tenant ID
  redirectUri: 'https://pebble.github.io/oauth-receiver/', // Standard OAuth receiver
  scope: 'https://graph.microsoft.com/Mail.Send offline_access',
  responseType: 'code',                     // Authorization code with PKCE
  responseMode: 'fragment'                  // Return tokens in URL fragment
};
```

### No Server Setup Required! 

With PKCE flow, you don't need to host any callback servers. The token exchange happens directly in the client using the authorization code and PKCE verifier.

## OAuth Flow Implementation

### Current Implementation Status

The current implementation includes:

✅ **PKCE Code Generation**: Generates secure code verifier and challenge
✅ **Token Exchange**: Direct authorization code to token exchange
✅ **State Parameter**: Implements CSRF protection with random state values  
✅ **Token Refresh**: Automatic token refresh when tokens are near expiration
✅ **Error Handling**: Comprehensive error handling for various failure scenarios
✅ **Fallback Authentication**: Manual token input for development/testing
✅ **No Server Required**: Complete OAuth flow without hosting callbacks

✨ **Ready to Use**: Just add your Azure app configuration and it works!

### Development and Production

**Both Development and Production:**
- Use the same PKCE OAuth flow
- No server-side components needed
- Automatic token refresh handling
- Secure token storage in local settings

**For Testing:**
- Use manual token input option in config
- Get test tokens from [Microsoft Graph Explorer](https://developer.microsoft.com/en-us/graph/graph-explorer)
- Test with your own Microsoft account

## Testing the OAuth Flow

### PKCE Flow Testing

1. Configure the app with your Azure app details
2. Open the configuration page on your Pebble
3. Click "Sign in with Microsoft"
4. Complete OAuth flow in browser
5. Authorization code is automatically exchanged for tokens
6. Tokens are stored securely in app settings

### Manual Token Testing

For development or if OAuth doesn't work:
1. Go to [Microsoft Graph Explorer](https://developer.microsoft.com/en-us/graph/graph-explorer)
2. Sign in with your Microsoft account
3. Use the access token in the manual input field
4. Note: Manual tokens expire and need frequent renewal

## Security Best Practices

1. **PKCE Protection**: Uses Proof Key for Code Exchange to prevent authorization code interception
2. **State Validation**: Prevents CSRF attacks with random state parameters
3. **Secure Storage**: Stores tokens locally with expiration tracking
4. **Token Rotation**: Implements proper token refresh and rotation
5. **Scope Limitation**: Only requests the minimum required permissions (Mail.Send)
6. **No Secrets**: No client secrets stored anywhere in the application

## Quick Setup Summary

1. ✅ Create Azure app registration
2. ✅ Set platform to "Single-page application"  
3. ✅ Add redirect URI: `https://pebble.github.io/oauth-receiver/`
4. ✅ Grant Mail.Send + offline_access permissions
5. ✅ Enable public client flows
6. ✅ Update `clientId` in the code
7. ✅ Test OAuth flow in Pebble config

**That's it! No servers to host, no callbacks to implement.** 🎉

## Troubleshooting

### Common Issues

1. **"Invalid redirect URI"**
   - Ensure redirect URI is exactly: `https://pebble.github.io/oauth-receiver/`
   - Check that platform is set to "Single-page application" not "Web"

2. **"Invalid client"**
   - Verify the client ID is correct
   - Check tenant ID configuration ('common' vs specific tenant)

3. **"Public client flows not enabled"**
   - Go to Authentication > Advanced settings
   - Set "Allow public client flows" to "Yes"

4. **"Insufficient privileges"**
   - Ensure Mail.Send permission is granted and consented
   - Admin consent may be required in some organizations

5. **"PKCE verification failed"**
   - This is handled automatically by the app
   - If persistent, clear browser cache and try again

### Debug Mode

Enable verbose logging in the JavaScript console to debug OAuth issues:

```javascript
console.log('OAuth URL:', authUrl);
console.log('State parameter:', state);
console.log('Token response:', tokenResponse);
```

## Next Steps

1. **Set up your Azure app registration** following the steps above (5 minutes)
2. **Update the OAuth configuration** in the code with your client ID
3. **Test the authentication flow** on your Pebble watch
4. **Configure your contacts and target email**
5. **Set up the iOS Shortcut** to process the emails

**No servers to deploy, no callbacks to implement!** The PKCE flow handles everything securely within the app itself.

For questions or issues, refer to the [Microsoft Graph documentation](https://docs.microsoft.com/en-us/graph/auth/) and [PKCE specification](https://tools.ietf.org/html/rfc7636) for detailed guidance.