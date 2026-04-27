/* global localStorage, Pebble */

console.log('=== JAVASCRIPT FILE STARTING ===');
console.log('Pebble object available: ' + (typeof Pebble !== 'undefined'));

// AppKeys
var KEY_CONTACT_INDEX = 0;
var KEY_VOICE_TEXT = 1;
var KEY_ERROR = 2;
var KEY_STATUS = 3;
var KEY_CONTACT_NAMES = 4;

// Register appmessage handler IMMEDIATELY
console.log('=== REGISTERING APPMESSAGE HANDLER ===');
Pebble.addEventListener('appmessage', function(e) {
  console.log('=== APPMESSAGE HANDLER TRIGGERED ===');
  console.log('Raw event: ' + JSON.stringify(e));
  console.log('Event payload: ' + JSON.stringify(e.payload));
  
  handleAppMessage(e);
});

// Function to handle app messages
function handleAppMessage(e) {
  console.log('=== MESSAGE HANDLER TRIGGERED ===');
  
  var dict = e.payload || {};
  var index = dict[KEY_CONTACT_INDEX];
  var text = dict[KEY_VOICE_TEXT];
  var s = getSettings();
  
  console.log('=== Message received from watch ===');
  console.log('Parsed contact index: ' + index);
  console.log('Parsed voice text: ' + text);
  
  console.log('Contact index: ' + index);
  console.log('Voice text: ' + text);
  console.log('Current settings: ' + JSON.stringify(s));

  // Validation
  if (typeof index !== 'number' || !s.contacts[index]) {
    console.log('ERROR: Invalid contact index');
    var msg = {};
    msg[KEY_ERROR] = 'Invalid contact selected';
    Pebble.sendAppMessage(msg);
    return;
  }
  
  if (!text || !text.length) {
    console.log('ERROR: Empty voice message');
    var msg = {};
    msg[KEY_ERROR] = 'No voice message recorded';
    Pebble.sendAppMessage(msg);
    return;
  }
  
  if (!s.graph || !s.graph.accessToken) {
    console.log('ERROR: Missing access token');
    var msg = {};
    msg[KEY_ERROR] = 'Missing access token - please sign in';
    Pebble.sendAppMessage(msg);
    return;
  }
  
  if (!s.targetEmail) {
    console.log('ERROR: Missing target email');
    var msg = {};
    msg[KEY_ERROR] = 'Missing target email - check settings';
    Pebble.sendAppMessage(msg);
    return;
  }

  var contact = s.contacts[index];
  console.log('Sending message for contact: ' + contact.name + ' (' + contact.phone + ')');

  // Send status update to watch
  var statusMsg = {};
  statusMsg[KEY_STATUS] = 'Authenticating...';
  Pebble.sendAppMessage(statusMsg);

  // Ensure we have a valid token before sending
  ensureValidToken(function(error, accessToken) {
    if (error) {
      console.log('ERROR: Token validation failed:', error);
      var msg = {};
      msg[KEY_ERROR] = 'Authentication failed - please sign in again';
      Pebble.sendAppMessage(msg);
      return;
    }

    console.log('Token validated successfully, proceeding with email send');
    sendEmailWithToken(accessToken, contact, text, s.targetEmail);
  });
}

// Separate function to handle the actual email sending
function sendEmailWithToken(accessToken, contact, messageText, targetEmail) {
  console.log('Sending email with validated token...');
  
  // Create the JSON object for SMS processing
  var messageData = {
    recipient: contact.name,
    message: messageText
  };

  var emailBody = JSON.stringify(messageData);
  console.log('JSON payload: ' + emailBody);

  // Construct Graph sendMail payload
  var body = {
    message: {
      subject: 'NEW TEXT MESSAGE',
      body: { contentType: 'Text', content: emailBody },
      toRecipients: [ { emailAddress: { address: targetEmail } } ]
    },
    saveToSentItems: true
  };

  // Update status
  var statusMsg = {};
  statusMsg[KEY_STATUS] = 'Sending email...';
  Pebble.sendAppMessage(statusMsg);

  console.log('Sending email via Microsoft Graph...');
  console.log('Request URL: https://graph.microsoft.com/v1.0/me/sendMail');
  console.log('Request body: ' + JSON.stringify(body, null, 2));
  
  // Try modern fetch first, fallback to XMLHttpRequest
  if (typeof fetch === 'function') {
    sendEmailWithFetch(accessToken, body, contact);
  } else {
    sendEmailWithXHR(accessToken, body, contact);
  }
}

function sendEmailWithFetch(accessToken, body, contact) {
  console.log('Using fetch API for email sending...');
  
  var timeoutPromise = new Promise(function(resolve, reject) {
    setTimeout(function() {
      console.log('TIMEOUT: Email request timed out after 30 seconds');
      reject(new Error('Request timeout after 30 seconds'));
    }, 30000);
  });

  var fetchPromise = fetch('https://graph.microsoft.com/v1.0/me/sendMail', {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + accessToken,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  })
  .then(function(response) {
    console.log('Email API response status: ' + response.status);
    console.log('Email API response headers: ' + JSON.stringify(Array.from(response.headers.entries())));
    
    if (response.status === 202 || response.status === 200) {
      console.log('SUCCESS: Email sent successfully via fetch');
      return { success: true, status: response.status };
    } else {
      return response.text().then(function(errorText) {
        console.log('Email API error body: ' + errorText);
        throw new Error('HTTP ' + response.status + ': ' + errorText);
      });
    }
  });

  Promise.race([fetchPromise, timeoutPromise])
    .then(function(result) {
      console.log('Email sending completed successfully!');
      var msg = {};
      msg[KEY_STATUS] = 'Email sent to ' + contact.name + '!';
      Pebble.sendAppMessage(msg);
    })
    .catch(function(err) {
      handleEmailError(err, contact);
    });
}

function sendEmailWithXHR(accessToken, body, contact) {
  console.log('Using XMLHttpRequest for email sending...');
  
  var xhr = new XMLHttpRequest();
  xhr.timeout = 30000; // 30 second timeout
  
  xhr.onreadystatechange = function() {
    if (xhr.readyState === 4) {
      console.log('Email XHR response - status: ' + xhr.status);
      
      if (xhr.status === 202 || xhr.status === 200) {
        console.log('SUCCESS: Email sent successfully via XHR');
        var msg = {};
        msg[KEY_STATUS] = 'Email sent to ' + contact.name + '!';
        Pebble.sendAppMessage(msg);
      } else {
        console.log('Email XHR error: ' + xhr.responseText);
        var error = new Error('HTTP ' + xhr.status + ': ' + xhr.responseText);
        handleEmailError(error, contact);
      }
    }
  };
  
  xhr.ontimeout = function() {
    console.log('Email XHR timed out');
    var error = new Error('Request timeout after 30 seconds');
    handleEmailError(error, contact);
  };
  
  xhr.onerror = function() {
    console.log('Email XHR network error');
    var error = new Error('Network error during email send');
    handleEmailError(error, contact);
  };
  
  xhr.open('POST', 'https://graph.microsoft.com/v1.0/me/sendMail');
  xhr.setRequestHeader('Authorization', 'Bearer ' + accessToken);
  xhr.setRequestHeader('Content-Type', 'application/json');
  xhr.send(JSON.stringify(body));
}

function handleEmailError(err, contact) {
  console.log('ERROR: Email sending failed');
  console.log('Error details: ' + err);
  
  var errorMsg = String(err && err.message || err);
  if (errorMsg.includes('401') || errorMsg.includes('unauthorized')) {
    errorMsg = 'Access token expired - please sign in again';
  } else if (errorMsg.includes('403') || errorMsg.includes('forbidden')) {
    errorMsg = 'Permission denied - check token permissions';
  } else if (errorMsg.includes('400')) {
    errorMsg = 'Invalid email format';
  } else if (errorMsg.includes('timeout')) {
    errorMsg = 'Request timed out - check connection';
  } else if (errorMsg.includes('network') || errorMsg.includes('fetch')) {
    errorMsg = 'Network error - check connection';
  } else {
    errorMsg = 'Email sending failed: ' + errorMsg;
  }
  
  var msg = {};
  msg[KEY_ERROR] = errorMsg;
  Pebble.sendAppMessage(msg);
}

// Remove Clay completely - use traditional Pebble configuration


// Settings functions
function getSettings() {
  try {
    return JSON.parse(localStorage.getItem('settings')) || { 
      contacts: [], 
      graph: { accessToken: '' }, 
      targetEmail: '' 
    };
  } catch (e) {
    return { 
      contacts: [], 
      graph: { accessToken: '' }, 
      targetEmail: '' 
    };
  }
}


function setSettings(s) {
  localStorage.setItem('settings', JSON.stringify(s));
}


function sendContactsToWatch() {
  var s = getSettings();
  console.log('Current settings: ' + JSON.stringify(s));
  console.log('Contacts array: ' + JSON.stringify(s.contacts));
  console.log('Contacts length: ' + s.contacts.length);
  
  if (s.contacts.length === 0) {
    console.log('No contacts found, sending empty string');
  }
  
  var names = s.contacts.map(function(c) { return c.name; }).join('\n');
  console.log('Sending contacts to watch: "' + names + '"');
  var msg = {};
  msg[KEY_CONTACT_NAMES] = names;
  Pebble.sendAppMessage(msg, 
    function() {
      console.log('Contacts sent successfully');
    }, 
    function(e) {
      console.log('Failed to send contacts: ' + JSON.stringify(e));
    }
  );
}


Pebble.addEventListener('ready', function() {
  console.log('=== PKJS READY EVENT ===');
  console.log('Pebble object available: ' + (typeof Pebble !== 'undefined'));
  console.log('sendAppMessage available: ' + (typeof Pebble.sendAppMessage === 'function'));
  
  // Test message sending to watch immediately
  console.log('Testing message sending to watch...');
  var testMsg = {};
  testMsg[KEY_STATUS] = 'JS Ready!';
  Pebble.sendAppMessage(testMsg, 
    function() { console.log('Test message sent OK'); },
    function(e) { console.log('Test message failed: ' + JSON.stringify(e)); }
  );
  
  sendContactsToWatch();
  
  // Test heartbeat to ensure JS is running
  setInterval(function() {
    console.log('=== JS HEARTBEAT === ' + new Date().toISOString());
  }, 10000);
});

// OAuth 2.0 Configuration for Public Client (PKCE Flow)
var OAUTH_CONFIG = {
  clientId: 'YOUR_ENTRA_APP_CLIENT_ID_HERE', // Replace with your Entra App Client ID
  tenantId: 'common', // Use 'common' for multi-tenant, or your specific tenant ID
  redirectUri: 'https://pebble.github.io/oauth-receiver/', // Pebble's hosted OAuth receiver
  scope: 'https://graph.microsoft.com/Mail.Send offline_access',
  responseType: 'code', // Using authorization code with PKCE
  responseMode: 'fragment' // Return tokens in URL fragment for security
};

// PKCE (Proof Key for Code Exchange) helper functions
function generateCodeVerifier() {
  var array = new Uint8Array(32);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    crypto.getRandomValues(array);
  } else {
    // Fallback for older browsers
    for (var i = 0; i < array.length; i++) {
      array[i] = Math.floor(Math.random() * 256);
    }
  }
  return base64URLEncode(array);
}

function base64URLEncode(buffer) {
  var base64 = '';
  var bytes = new Uint8Array(buffer);
  for (var i = 0; i < bytes.byteLength; i++) {
    base64 += String.fromCharCode(bytes[i]);
  }
  return btoa(base64)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
}

function generateCodeChallenge(codeVerifier) {
  // For simplicity, we'll use plain text challenge method
  // In production, you might want to implement SHA256 hashing
  return codeVerifier;
}

// Generate OAuth authorization URL with PKCE
function generateAuthUrl(state, codeVerifier) {
  var codeChallenge = generateCodeChallenge(codeVerifier);
  var baseUrl = 'https://login.microsoftonline.com/' + OAUTH_CONFIG.tenantId + '/oauth2/v2.0/authorize';
  var params = [
    'client_id=' + encodeURIComponent(OAUTH_CONFIG.clientId),
    'response_type=' + encodeURIComponent(OAUTH_CONFIG.responseType),
    'redirect_uri=' + encodeURIComponent(OAUTH_CONFIG.redirectUri),
    'scope=' + encodeURIComponent(OAUTH_CONFIG.scope),
    'response_mode=' + encodeURIComponent(OAUTH_CONFIG.responseMode),
    'state=' + encodeURIComponent(state),
    'code_challenge=' + encodeURIComponent(codeChallenge),
    'code_challenge_method=plain' // Using plain text for simplicity
  ];
  return baseUrl + '?' + params.join('&');
}

// Exchange authorization code for tokens using PKCE
function exchangeCodeForTokens(authCode, codeVerifier, callback) {
  console.log('Exchanging authorization code for tokens...');
  
  var tokenUrl = 'https://login.microsoftonline.com/' + OAUTH_CONFIG.tenantId + '/oauth2/v2.0/token';
  var body = [
    'client_id=' + encodeURIComponent(OAUTH_CONFIG.clientId),
    'scope=' + encodeURIComponent(OAUTH_CONFIG.scope),
    'code=' + encodeURIComponent(authCode),
    'redirect_uri=' + encodeURIComponent(OAUTH_CONFIG.redirectUri),
    'grant_type=authorization_code',
    'code_verifier=' + encodeURIComponent(codeVerifier)
  ].join('&');
  
  var xhr = new XMLHttpRequest();
  xhr.open('POST', tokenUrl);
  xhr.setRequestHeader('Content-Type', 'application/x-www-form-urlencoded');
  
  xhr.onreadystatechange = function() {
    if (xhr.readyState === 4) {
      console.log('Token exchange response status:', xhr.status);
      
      if (xhr.status === 200) {
        try {
          var response = JSON.parse(xhr.responseText);
          console.log('Token exchange successful');
          callback(null, {
            accessToken: response.access_token,
            refreshToken: response.refresh_token,
            expiresIn: response.expires_in,
            tokenType: response.token_type,
            scope: response.scope,
            expiresAt: Date.now() + (response.expires_in * 1000)
          });
        } catch (e) {
          console.log('Error parsing token response:', e);
          callback('Failed to parse token response');
        }
      } else {
        console.log('Token exchange failed:', xhr.responseText);
        callback('Authentication failed: ' + xhr.status);
      }
    }
  };
  
  xhr.send(body);
}

// Refresh access token using refresh token
function refreshAccessToken(refreshToken, callback) {
  console.log('Refreshing access token...');
  
  var tokenUrl = 'https://login.microsoftonline.com/' + OAUTH_CONFIG.tenantId + '/oauth2/v2.0/token';
  var body = [
    'client_id=' + encodeURIComponent(OAUTH_CONFIG.clientId),
    'scope=' + encodeURIComponent(OAUTH_CONFIG.scope),
    'refresh_token=' + encodeURIComponent(refreshToken),
    'grant_type=refresh_token'
  ].join('&');
  
  var xhr = new XMLHttpRequest();
  xhr.open('POST', tokenUrl);
  xhr.setRequestHeader('Content-Type', 'application/x-www-form-urlencoded');
  
  xhr.onreadystatechange = function() {
    if (xhr.readyState === 4) {
      console.log('Token refresh response status:', xhr.status);
      
      if (xhr.status === 200) {
        try {
          var response = JSON.parse(xhr.responseText);
          console.log('Token refresh successful');
          callback(null, {
            accessToken: response.access_token,
            refreshToken: response.refresh_token || refreshToken, // Some responses don't include new refresh token
            expiresIn: response.expires_in,
            tokenType: response.token_type,
            scope: response.scope,
            expiresAt: Date.now() + (response.expires_in * 1000)
          });
        } catch (e) {
          console.log('Error parsing refresh response:', e);
          callback('Failed to parse refresh response');
        }
      } else {
        console.log('Token refresh failed:', xhr.responseText);
        callback('Token refresh failed: ' + xhr.status);
      }
    }
  };
  
  xhr.send(body);
}

// Check if token needs refresh and refresh if necessary
function ensureValidToken(callback) {
  var settings = getSettings();
  
  if (!settings.graph || !settings.graph.accessToken) {
    callback('No access token available');
    return;
  }
  
  // Check if token is expired or will expire in the next 5 minutes
  var now = Date.now();
  var expiresAt = settings.graph.expiresAt || 0;
  var bufferTime = 5 * 60 * 1000; // 5 minutes
  
  if (now + bufferTime >= expiresAt) {
    console.log('Token expired or expiring soon, refreshing...');
    
    if (!settings.graph.refreshToken) {
      callback('Token expired and no refresh token available');
      return;
    }
    
    refreshAccessToken(settings.graph.refreshToken, function(error, tokens) {
      if (error) {
        callback(error);
        return;
      }
      
      // Update settings with new tokens
      settings.graph = tokens;
      setSettings(settings);
      callback(null, tokens.accessToken);
    });
  } else {
    console.log('Token is still valid');
    callback(null, settings.graph.accessToken);
  }
}

// Traditional Pebble configuration approach
Pebble.addEventListener('showConfiguration', function() {
  console.log('showConfiguration fired - opening config page');
  var settings = getSettings();
  var configData = encodeURIComponent(JSON.stringify(settings));
  
  // Generate state parameter and code verifier for OAuth security
  var oauthState = Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
  var codeVerifier = generateCodeVerifier();
  
  // Store PKCE values for later use
  localStorage.setItem('oauth_state', oauthState);
  localStorage.setItem('code_verifier', codeVerifier);
  
  var authUrl = generateAuthUrl(oauthState, codeVerifier);
  
  // Use a simple hosted configuration page
  var configURL = 'data:text/html;charset=utf-8,' + encodeURIComponent(`
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Send Message Config</title>
    <style>
        body { font-family: Arial, sans-serif; padding: 20px; background: #f5f5f5; margin: 0; }
        .form { background: white; padding: 20px; border-radius: 8px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); max-width: 600px; margin: 0 auto; }
        .field { margin-bottom: 15px; }
        label { display: block; margin-bottom: 5px; font-weight: bold; color: #333; }
        input { width: 100%; padding: 10px; border: 1px solid #ddd; border-radius: 4px; box-sizing: border-box; font-size: 14px; }
        input[type="password"] { font-family: monospace; }
        .section { margin-top: 30px; padding-top: 20px; border-top: 1px solid #eee; }
        .buttons { margin-top: 30px; text-align: center; }
        button { padding: 12px 24px; margin: 0 10px; border: none; border-radius: 4px; font-size: 16px; cursor: pointer; }
        .save { background: #007AFF; color: white; }
        .cancel { background: #8E8E93; color: white; }
        .oauth-section { background: #f8f9fa; padding: 15px; border-radius: 4px; margin-bottom: 20px; }
        .oauth-button { background: #0078d4; color: white; padding: 10px 20px; text-decoration: none; border-radius: 4px; display: inline-block; margin: 10px 0; }
        .token-status { padding: 10px; border-radius: 4px; margin: 10px 0; }
        .token-valid { background: #d4edda; color: #155724; border: 1px solid #c3e6cb; }
        .token-invalid { background: #f8d7da; color: #721c24; border: 1px solid #f5c6cb; }
        .token-info { font-size: 12px; color: #666; margin-top: 5px; }
        .help-text { font-size: 12px; color: #666; margin-top: 5px; line-height: 1.4; }
        .manual-section { margin-top: 15px; padding-top: 15px; border-top: 1px solid #eee; }
        .toggle-manual { background: none; border: none; color: #007AFF; cursor: pointer; text-decoration: underline; font-size: 14px; }
    </style>
</head>
<body>
    <div class="form">
        <h1>Send Message Configuration</h1>
        
            <div class="oauth-section">
                <h2>Microsoft Graph Authentication</h2>
                <div id="authStatus" class="token-status" style="display: none;"></div>
                <a href="#" id="loginButton" class="oauth-button">Sign in with Microsoft</a>
                <div class="help-text">
                    Sign in with your Microsoft account to allow the app to send emails on your behalf. 
                    This uses the secure OAuth 2.0 flow with PKCE for public clients.
                </div>
                
                <div class="manual-section">
                    <button type="button" class="toggle-manual" onclick="toggleManualAuth()">
                        Use manual token instead (advanced)
                    </button>
                    <div id="manualAuthSection" style="display: none;">
                        <div class="field">
                            <label>Access Token (Manual)</label>
                            <input type="password" id="accessToken" placeholder="Enter access token manually">
                            <div class="help-text">
                                Only use this if OAuth sign-in doesn't work. Get tokens from Microsoft Graph Explorer.
                                Tokens expire frequently and need manual renewal.
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        
        <div class="field">
            <label>Target Email Address</label>
            <input type="email" id="targetEmail" placeholder="recipient@example.com">
            <div class="help-text">
                The email address where messages will be sent. This should be monitored by your iOS Shortcut.
            </div>
        </div>
        
        <div class="section">
            <h2>Contacts</h2>
            
            <div class="field">
                <label>Contact 1 Name</label>
                <input type="text" id="contact1Name" placeholder="Alice">
            </div>
            <div class="field">
                <label>Contact 1 Phone</label>
                <input type="tel" id="contact1Phone" placeholder="+1234567890">
            </div>
            
            <div class="field">
                <label>Contact 2 Name</label>
                <input type="text" id="contact2Name" placeholder="Bob">
            </div>
            <div class="field">
                <label>Contact 2 Phone</label>
                <input type="tel" id="contact2Phone" placeholder="+1234567891">
            </div>
            
            <div class="field">
                <label>Contact 3 Name</label>
                <input type="text" id="contact3Name" placeholder="Charlie">
            </div>
            <div class="field">
                <label>Contact 3 Phone</label>
                <input type="tel" id="contact3Phone" placeholder="+1234567892">
            </div>
        </div>
        
        <div class="buttons">
            <button class="save" onclick="saveConfig()">Save</button>
            <button class="cancel" onclick="cancelConfig()">Cancel</button>
        </div>
    </div>

    <script>
        // OAuth configuration - these should match your Entra app registration
        var OAUTH_CONFIG = {
            clientId: '${OAUTH_CONFIG.clientId}',
            authUrl: '${authUrl}'
        };
        
        var currentSettings = {};
        
        function loadSettings() {
            try {
                var params = new URLSearchParams(window.location.search);
                var data = params.get('data');
                if (data) {
                    currentSettings = JSON.parse(decodeURIComponent(data));
                    
                    // Show current auth status
                    updateAuthStatus();
                    
                    document.getElementById('targetEmail').value = currentSettings.targetEmail || '';
                    
                    for (var i = 0; i < (currentSettings.contacts || []).length && i < 3; i++) {
                        document.getElementById('contact' + (i+1) + 'Name').value = currentSettings.contacts[i].name || '';
                        document.getElementById('contact' + (i+1) + 'Phone').value = currentSettings.contacts[i].phone || '';
                    }
                    
                    // Check for OAuth callback
                    checkForOAuthCallback();
                }
            } catch (e) {
                console.log('Error loading settings: ' + e);
            }
        }
        
        function updateAuthStatus() {
            var statusDiv = document.getElementById('authStatus');
            var loginButton = document.getElementById('loginButton');
            
            if (currentSettings.graph && currentSettings.graph.accessToken) {
                var expiresAt = currentSettings.graph.expiresAt || 0;
                var now = Date.now();
                
                if (now < expiresAt) {
                    statusDiv.className = 'token-status token-valid';
                    statusDiv.innerHTML = '✓ Signed in successfully<div class="token-info">Token expires: ' + new Date(expiresAt).toLocaleString() + '</div>';
                    loginButton.textContent = 'Re-authenticate';
                } else {
                    statusDiv.className = 'token-status token-invalid';
                    statusDiv.innerHTML = '⚠ Token expired - please sign in again';
                    loginButton.textContent = 'Sign in with Microsoft';
                }
            } else {
                statusDiv.className = 'token-status token-invalid';
                statusDiv.innerHTML = '⚠ Not authenticated - please sign in';
                loginButton.textContent = 'Sign in with Microsoft';
            }
            
            statusDiv.style.display = 'block';
        }
        
        function checkForOAuthCallback() {
            // Check if we're being called back from OAuth
            var params = new URLSearchParams(window.location.search);
            var code = params.get('code');
            var state = params.get('state');
            var error = params.get('error');
            
            if (error) {
                alert('Authentication failed: ' + (params.get('error_description') || error));
                return;
            }
            
            if (code && state) {
                // This is an OAuth callback - exchange code for tokens
                exchangeCodeForTokens(code, state);
            }
        }
        
        function exchangeCodeForTokens(code, state) {
            // Validate state parameter
            var storedState = localStorage.getItem('oauth_state');
            var storedVerifier = localStorage.getItem('code_verifier');
            
            if (state !== storedState) {
                alert('Security error: Invalid state parameter');
                return;
            }
            
            if (!storedVerifier) {
                alert('Security error: Missing code verifier');
                return;
            }
            
            // Show loading state
            var statusDiv = document.getElementById('authStatus');
            statusDiv.className = 'token-status';
            statusDiv.innerHTML = '⏳ Exchanging authorization code for tokens...';
            statusDiv.style.display = 'block';
            
            // Exchange code for tokens
            var tokenUrl = 'https://login.microsoftonline.com/${OAUTH_CONFIG.tenantId}/oauth2/v2.0/token';
            var body = [
                'client_id=' + encodeURIComponent('${OAUTH_CONFIG.clientId}'),
                'scope=' + encodeURIComponent('${OAUTH_CONFIG.scope}'),
                'code=' + encodeURIComponent(code),
                'redirect_uri=' + encodeURIComponent('${OAUTH_CONFIG.redirectUri}'),
                'grant_type=authorization_code',
                'code_verifier=' + encodeURIComponent(storedVerifier)
            ].join('&');
            
            var xhr = new XMLHttpRequest();
            xhr.open('POST', tokenUrl);
            xhr.setRequestHeader('Content-Type', 'application/x-www-form-urlencoded');
            
            xhr.onreadystatechange = function() {
                if (xhr.readyState === 4) {
                    if (xhr.status === 200) {
                        try {
                            var response = JSON.parse(xhr.responseText);
                            console.log('Token exchange successful');
                            
                            // Store tokens in current settings
                            currentSettings.graph = {
                                accessToken: response.access_token,
                                refreshToken: response.refresh_token,
                                expiresIn: response.expires_in,
                                tokenType: response.token_type,
                                scope: response.scope,
                                expiresAt: Date.now() + (response.expires_in * 1000)
                            };
                            
                            // Clean up stored OAuth values
                            localStorage.removeItem('oauth_state');
                            localStorage.removeItem('code_verifier');
                            
                            updateAuthStatus();
                            
                        } catch (e) {
                            console.log('Error parsing token response:', e);
                            statusDiv.className = 'token-status token-invalid';
                            statusDiv.innerHTML = '❌ Failed to parse token response';
                        }
                    } else {
                        console.log('Token exchange failed:', xhr.responseText);
                        statusDiv.className = 'token-status token-invalid';
                        statusDiv.innerHTML = '❌ Authentication failed: HTTP ' + xhr.status;
                    }
                }
            };
            
            xhr.send(body);
        }
        
        function toggleManualAuth() {
            var section = document.getElementById('manualAuthSection');
            var isHidden = section.style.display === 'none';
            section.style.display = isHidden ? 'block' : 'none';
        }
        
        function saveConfig() {
            // Prepare settings object
            var settings = {
                contacts: [],
                graph: currentSettings.graph || {},
                targetEmail: document.getElementById('targetEmail').value
            };
            
            // Check if manual token was entered
            var manualToken = document.getElementById('accessToken').value.trim();
            if (manualToken && (!settings.graph.accessToken || manualToken !== settings.graph.accessToken)) {
                // User entered a manual token
                settings.graph = {
                    accessToken: manualToken,
                    refreshToken: '', // Manual tokens don't have refresh tokens
                    expiresAt: Date.now() + (3600 * 1000), // Assume 1 hour expiry
                    tokenType: 'Bearer',
                    scope: 'Manual'
                };
            }
            
            // Collect contacts
            for (var i = 1; i <= 3; i++) {
                var name = document.getElementById('contact' + i + 'Name').value.trim();
                var phone = document.getElementById('contact' + i + 'Phone').value.trim();
                if (name && phone) {
                    settings.contacts.push({ name: name, phone: phone });
                }
            }
            
            var result = JSON.stringify(settings);
            window.location = 'pebblejs://close#' + encodeURIComponent(result);
        }
        
        function cancelConfig() {
            window.location = 'pebblejs://close#';
        }
        
        // Set up OAuth login button
        document.addEventListener('DOMContentLoaded', function() {
            document.getElementById('loginButton').addEventListener('click', function(e) {
                e.preventDefault();
                // Open OAuth URL in new window
                window.open(OAUTH_CONFIG.authUrl, '_blank');
            });
        });
        
        // Load existing settings when page opens
        loadSettings();
    </script>
</body>
</html>
  `);
  
  console.log('Opening config URL');
  Pebble.openURL(configURL);
});


// Handle configuration results
Pebble.addEventListener('webviewclosed', function(e) {
  console.log('=== Configuration closed ===');
  console.log('Response: ' + (e.response || 'No response'));
  
  if (e.response) {
    try {
      var newSettings = JSON.parse(decodeURIComponent(e.response));
      console.log('New settings: ' + JSON.stringify(newSettings));
      setSettings(newSettings);
      sendContactsToWatch();
    } catch (error) {
      console.log('Error parsing config response: ' + error);
    }
  }
});

console.log('=== JAVASCRIPT FILE FULLY LOADED ===');