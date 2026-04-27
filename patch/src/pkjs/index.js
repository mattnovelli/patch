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
  clientId: 'b9260194-8028-48ae-8907-e30182eda409', // Shared default client ID (BYO override available in config page)
  tenantId: 'common', // Use 'common' for multi-tenant, or your specific tenant ID
  redirectUri: 'https://mattnovelli.github.io/pebble-message/', // Hosted OAuth receiver page (GitHub Pages /docs)
  scope: 'https://graph.microsoft.com/Mail.Send offline_access',
  responseType: 'code', // Using authorization code with PKCE
  responseMode: 'query' // Authorization code callback in query params
};

// Hosted configuration page URL (typically a GitHub Pages URL).
// This page should handle OAuth and return settings via pebblejs://close#<json>
var CONFIG_PAGE_URL = OAUTH_CONFIG.redirectUri;

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

// Hosted configuration page approach (GitHub Pages, custom domain, etc.)
Pebble.addEventListener('showConfiguration', function() {
  console.log('showConfiguration fired - opening hosted config page');
  var settings = getSettings();

  var sep = CONFIG_PAGE_URL.indexOf('?') === -1 ? '?' : '&';
  var configURL = CONFIG_PAGE_URL + sep + [
    't=' + Date.now(),
    'settings=' + encodeURIComponent(JSON.stringify(settings)),
    'client_id=' + encodeURIComponent(OAUTH_CONFIG.clientId),
    'tenant=' + encodeURIComponent(OAUTH_CONFIG.tenantId),
    'scope=' + encodeURIComponent(OAUTH_CONFIG.scope)
  ].join('&');

  console.log('Opening config URL: ' + configURL);
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