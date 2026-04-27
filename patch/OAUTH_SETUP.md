# OAuth 2.0 Setup Guide for Microsoft Graph (GitHub Pages Receiver)

This project now uses a hosted OAuth receiver page (GitHub Pages) instead of Pebble's legacy hosted receiver.

The OAuth flow is still Authorization Code + PKCE, but the redirect target is now your own static page that:

1. Starts Microsoft sign-in.
2. Receives the `code` callback.
3. Exchanges `code` for tokens.
4. Returns the settings JSON back to Pebble via `pebblejs://close#...`.

## Why This Changed

Pebble no longer provides a hosted OAuth receiver endpoint. The app therefore mirrors the approach used by projects such as Playback:

- Host a dedicated config/receiver page on GitHub Pages.
- Use that page URL as the Azure redirect URI.
- Open that page from `Pebble.openURL(...)`.

## Prerequisites

- Azure Active Directory (Entra ID) tenant access.
- A Microsoft 365 account allowed to send with Microsoft Graph.
- A GitHub repository for the hosted config page.

## Deployment Plan

### 1. Host the Receiver Page

This repository now includes a publish-ready site folder:

- `docs/index.html`

Publish it with GitHub Pages:

1. Open repository **Settings** > **Pages**.
2. Set source to branch `main` and folder `/docs`.
3. Save and wait for deployment.

Expected URL for this repository:

- `https://mattnovelli.github.io/pebble-message/`

This URL becomes your OAuth redirect URI and Pebble config URL.

### 2. Create Azure App Registration

1. Go to [Azure Portal](https://portal.azure.com).
2. Open **Microsoft Entra ID** > **App registrations** > **New registration**.
3. Set **Redirect URI**:
   - Platform: **Single-page application (SPA)**
   - URI: your GitHub Pages URL from Step 1 (exact match)

Important:

- Use SPA, not Web.
- Redirect URI must match exactly (including trailing slash/path).

### 3. Configure Microsoft Graph Permissions

Add delegated permissions:

- `Mail.Send`
- `offline_access`
- `User.Read` (typically default, keep enabled)

Grant admin consent if your tenant policy requires it.

### 4. Enable Public Client Flows

In **Authentication** > **Advanced settings**:

- Set **Allow public client flows** to **Yes**.

## Code Configuration

Update `src/pkjs/index.js`:

```javascript
var OAUTH_CONFIG = {
  clientId: "b9260194-8028-48ae-8907-e30182eda409",
  tenantId: "common",
  redirectUri: "https://mattnovelli.github.io/pebble-message/",
  scope: "https://graph.microsoft.com/Mail.Send offline_access",
  responseType: "code",
  responseMode: "query",
};

var CONFIG_PAGE_URL = OAUTH_CONFIG.redirectUri;
```

Notes:

- `CONFIG_PAGE_URL` should point to the hosted GitHub Pages URL for `docs/index.html`.
- The same URL should be in Azure Redirect URI.
- The hosted page defaults to the shared client ID above.
- The hosted page includes an expandable **Bring your own Entra app** section with a self-host tutorial and custom Client ID input.

## Runtime Flow (Current Implementation)

1. Pebble app opens hosted config page.
2. Hosted page loads existing settings from query/session storage.
3. User signs in with Microsoft.
4. Microsoft redirects back to that same hosted page with `?code=...`.
5. Hosted page exchanges code for tokens using PKCE.
6. Hosted page returns full settings JSON to Pebble via:
   - `pebblejs://close#<encoded-json>`
7. PKJS saves settings and continues using refresh tokens for renewal.

## Testing

1. Open Pebble app settings for Patch.
2. Verify config page opens from your GitHub Pages URL.
3. Sign in with Microsoft.
4. Save settings and verify contacts sync to watch.
5. Send a test message and confirm Graph `sendMail` succeeds.

## Troubleshooting

1. `Invalid redirect URI`
   - Ensure Azure Redirect URI exactly equals your hosted config page URL.
   - Check trailing slash and path.

2. `Public client flows disabled`
   - Enable public client flows in Azure Authentication settings.

3. `Token exchange failed`
   - Verify Client ID and tenant.
   - Confirm `Mail.Send` and `offline_access` are granted.
   - Check that the hosted page URL in Azure matches `receiverUri()` shown by the page.

4. OAuth returns but Pebble does not save settings
   - Ensure the hosted page returns with `pebblejs://close#...`.
   - Confirm `webviewclosed` logs show a JSON payload.

## Security Notes

- PKCE is used for authorization code exchange.
- State parameter validation is performed on the hosted page.
- No client secret is required.
- Tokens are stored in Pebble settings and refreshed when needed.
