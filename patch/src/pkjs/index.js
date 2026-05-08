/* global localStorage, Pebble */

console.log('=== JAVASCRIPT FILE STARTING ===');
console.log('Pebble object available: ' + (typeof Pebble !== 'undefined'));

// AppKeys
var KEY_CONTACT_INDEX = 0;
var KEY_VOICE_TEXT = 1;
var KEY_ERROR = 2;
var KEY_STATUS = 3;
var KEY_CONTACT_NAMES = 4;
var KEY_QUIT_AFTER_SEND = 5;
var KEY_AUTH_STATE = 6;
var KEY_CANNED_LABELS = 7;
var KEY_CANNED_INDEX = 8;

var AUTH_STATE_UNKNOWN = 0;
var AUTH_STATE_OK = 1;
var AUTH_STATE_REAUTH_REQUIRED = 2;

var MAX_CANNED_MESSAGES = 10;
var MAX_CANNED_MESSAGE_LENGTH = 140;
var CANNED_LABEL_MAX_CHARS = 28;

var CONTACT_EMOJI_DEFAULT_CODE = '1F603';
var CONTACT_EMOJI_ALLOWED_CODES = [
  '1F601',
  '1F602',
  '1F603',
  '1F604',
  '1F605',
  '1F606',
  '1F609',
  '1F60A',
  '1F60B',
  '1F60C',
  '1F60D',
  '1F60F',
  '1F612',
  '1F613',
  '1F614',
  '1F616',
  '1F618',
  '1F61A',
  '1F61C',
  '263A',
  '1F607',
  '1F608',
  '1F60E',
  '1F610',
  '1F611',
  '1F615',
  '1F617',
  '1F619',
  '1F61B',
  '1F61F',
  '1F626',
  '1F627',
  '1F62C',
  '1F62E',
  '1F62F',
  '1F634',
  '1F636',
  '1F425',
  '2764',
  '1F493',
  '1F61D',
  '1F61E',
  '1F620',
  '1F621',
  '1F622',
  '1F623',
  '1F624',
  '1F625',
  '1F628',
  '1F629',
  '1F62A',
  '1F62B',
  '1F62D',
  '1F630',
  '1F631',
  '1F632',
  '1F633',
  '1F635',
  '1F637',
  '1F600',
  '1F494',
  '1F495',
  '1F496',
  '1F497',
  '1F498',
  '1F49D',
  '1F49E',
  '1F49F',
  '1F37A',
  '1F37B',
  '1F389',
  '270B',
  '270C',
  '1F44D',
  '1F44E',
  '1F64F',
  '1F4A9'
];
var CONTACT_EMOJI_LOOKUP = {};

for (var emojiIndex = 0; emojiIndex < CONTACT_EMOJI_ALLOWED_CODES.length; emojiIndex++) {
  CONTACT_EMOJI_LOOKUP[CONTACT_EMOJI_ALLOWED_CODES[emojiIndex]] = true;
}

var TOKEN_REFRESH_BUFFER_MS = 10 * 60 * 1000;
var TOKEN_REFRESH_TIMEOUT_MS = 15 * 1000;
var TOKEN_REFRESH_MAX_ATTEMPTS = 3;
var TOKEN_REFRESH_BASE_RETRY_MS = 1200;
var DEBUG_HEARTBEAT_STORAGE_KEY = 'patch_pkjs_debug_heartbeat';

var s_refreshInFlight = false;
var s_refreshWaiters = [];

// Register appmessage handler IMMEDIATELY
console.log('=== REGISTERING APPMESSAGE HANDLER ===');
Pebble.addEventListener('appmessage', function(e) {
  console.log('=== APPMESSAGE HANDLER TRIGGERED ===');
  console.log('Appmessage payload keys: ' + Object.keys(e.payload || {}).join(','));
  
  handleAppMessage(e);
});

// Function to handle app messages
function handleAppMessage(e) {
  console.log('=== MESSAGE HANDLER TRIGGERED ===');
  
  var dict = e.payload || {};
  var index = dict[KEY_CONTACT_INDEX];
  var text = dict[KEY_VOICE_TEXT];
  var cannedIndex = dict[KEY_CANNED_INDEX];
  var isCannedSelection = typeof cannedIndex === 'number';
  var s = getSettings();
  var rawMessageText = '';
  
  console.log('=== Message received from watch ===');
  console.log('Message metadata: contactIndex=' + index + ', hasVoiceText=' + (!!text) + ', cannedIndex=' + (isCannedSelection ? cannedIndex : 'none'));
  console.log('Current settings summary: ' + getSettingsLogSummary(s));

  // Validation
  if (typeof index !== 'number' || !s.contacts[index]) {
    console.log('ERROR: Invalid contact index');
    var msg = {};
    msg[KEY_ERROR] = 'Invalid contact selected';
    Pebble.sendAppMessage(msg);
    return;
  }

  if (isCannedSelection) {
    if (cannedIndex < 0 || !s.cannedMessages || !s.cannedMessages[cannedIndex]) {
      console.log('ERROR: Invalid canned message selection');
      var cannedMsg = {};
      cannedMsg[KEY_ERROR] = 'Invalid canned message selected';
      Pebble.sendAppMessage(cannedMsg);
      return;
    }

    rawMessageText = String(s.cannedMessages[cannedIndex] || '');
    if (!rawMessageText.length) {
      console.log('ERROR: Empty canned message text');
      var emptyCannedMsg = {};
      emptyCannedMsg[KEY_ERROR] = 'Selected canned message is empty';
      Pebble.sendAppMessage(emptyCannedMsg);
      return;
    }
  } else {
    if (!text || !text.length) {
      console.log('ERROR: Empty voice message');
      var voiceMsg = {};
      voiceMsg[KEY_ERROR] = 'No voice message recorded';
      Pebble.sendAppMessage(voiceMsg);
      return;
    }

    rawMessageText = String(text);
  }
  
  if (!s.graph || (!s.graph.accessToken && !s.graph.refreshToken)) {
    console.log('ERROR: Missing access token');
    var msg = {};
    msg[KEY_ERROR] = 'Missing access token - please sign in';
    Pebble.sendAppMessage(msg);
    sendAuthStateToWatch(AUTH_STATE_REAUTH_REQUIRED);
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
  var outgoingMessageText = formatOutgoingMessageText(rawMessageText, s);
  console.log('Sending ' + (isCannedSelection ? 'canned' : 'dictated') + ' message for contactIndex=' + index);

  // Send status update to watch
  var statusMsg = {};
  statusMsg[KEY_STATUS] = 'Authenticating...';
  Pebble.sendAppMessage(statusMsg);

  // Ensure we have a valid token before sending
  ensureValidToken(function(error, accessToken) {
    if (error) {
      console.log('ERROR: Token validation failed: ' + JSON.stringify(error));
      var msg = {};
      msg[KEY_ERROR] = getTokenErrorMessage(error);
      Pebble.sendAppMessage(msg);

      if (error.requiresReauth) {
        sendAuthStateToWatch(AUTH_STATE_REAUTH_REQUIRED);
      }
      return;
    }

    console.log('Token validated successfully, proceeding with email send');
    sendEmailWithToken(accessToken, contact, outgoingMessageText, s.targetEmail);
  });
}

function formatOutgoingMessageText(messageText, settings) {
  var text = String(messageText || '');
  if (!settings || !settings.allLowercase) {
    return text;
  }

  return text.toLowerCase();
}

// Separate function to handle the actual email sending
function sendEmailWithToken(accessToken, contact, messageText, targetEmail) {
  console.log('Sending email with validated token...');
  
  // Create the JSON object for iOS Shortcut processing.
  // `recipient` carries the raw configured destination (phone or email string).
  var messageData = {
    message: messageText,
    recipient: String(contact.phone || '').trim(),
    name: String(contact.name || '').trim()
  };

  var emailBody = JSON.stringify(messageData);
  console.log('Prepared iOS Shortcut payload for send (content redacted).');

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
  console.log('Request body prepared (content redacted).');
  
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

  if (errorMsg.indexOf('sign in') !== -1 || errorMsg.indexOf('expired') !== -1) {
    sendAuthStateToWatch(AUTH_STATE_REAUTH_REQUIRED);
  }
}

// Remove Clay completely - use traditional Pebble configuration


// Settings functions
function normalizeEmojiCode(code) {
  var v = String(code || '').trim().toUpperCase();
  if (!v) {
    return '';
  }

  return CONTACT_EMOJI_LOOKUP[v] ? v : '';
}

function emojiCharFromCode(code) {
  var normalized = normalizeEmojiCode(code);
  if (!normalized) {
    return '';
  }

  if (typeof String.fromCodePoint !== 'function') {
    return '';
  }

  try {
    return String.fromCodePoint(parseInt(normalized, 16));
  } catch (e) {
    return '';
  }
}

function normalizeContact(contact) {
  var c = contact || {};
  return {
    name: String(c.name || '').trim(),
    phone: String(c.phone || '').trim(),
    emoji: normalizeEmojiCode(c.emoji)
  };
}

function normalizeContacts(contacts) {
  var list = Array.isArray(contacts) ? contacts : [];
  var normalized = [];

  for (var i = 0; i < list.length; i++) {
    var entry = normalizeContact(list[i]);
    if (entry.name && entry.phone) {
      normalized.push(entry);
    }
  }

  return normalized;
}

function normalizeCannedMessages(messages) {
  var list = Array.isArray(messages) ? messages : [];
  var normalized = [];

  for (var i = 0; i < list.length; i++) {
    var raw = list[i];
    var text = typeof raw === 'string' ? raw : (raw && raw.text);
    text = String(text || '').replace(/[\r\n]+/g, ' ').trim();

    if (!text) {
      continue;
    }

    if (text.length > MAX_CANNED_MESSAGE_LENGTH) {
      text = text.slice(0, MAX_CANNED_MESSAGE_LENGTH);
    }

    normalized.push(text);
    if (normalized.length >= MAX_CANNED_MESSAGES) {
      break;
    }
  }

  return normalized;
}

function toCannedLabel(messageText) {
  var label = String(messageText || '').trim();
  if (label.length <= CANNED_LABEL_MAX_CHARS) {
    return label;
  }

  var trimmedLength = CANNED_LABEL_MAX_CHARS - 3;
  if (trimmedLength < 1) {
    return label.slice(0, CANNED_LABEL_MAX_CHARS);
  }

  return label.slice(0, trimmedLength).trim() + '...';
}

function buildCannedLabelsPayload(cannedMessages) {
  var list = normalizeCannedMessages(cannedMessages);
  return list.map(function(messageText) {
    return toCannedLabel(messageText);
  }).join('\n');
}

function normalizeGraphForStorage(graph) {
  var g = graph || {};

  return {
    accessToken: String(g.accessToken || ''),
    refreshToken: String(g.refreshToken || ''),
    expiresIn: Number(g.expiresIn || 0),
    tokenType: String(g.tokenType || ''),
    scope: String(g.scope || ''),
    clientId: String(g.clientId || ''),
    tenantId: String(g.tenantId || ''),
    redirectUri: String(g.redirectUri || ''),
    expiresAt: Number(g.expiresAt || 0)
  };
}

function getSettingsLogSummary(settings) {
  var s = settings || {};
  var graph = s.graph || {};
  var contacts = Array.isArray(s.contacts) ? s.contacts : [];
  var cannedMessages = Array.isArray(s.cannedMessages) ? s.cannedMessages : [];

  return JSON.stringify({
    contactsCount: contacts.length,
    cannedMessagesCount: cannedMessages.length,
    hasTargetEmail: !!s.targetEmail,
    hasAccessToken: !!graph.accessToken,
    hasRefreshToken: !!graph.refreshToken,
    quitAfterSend: !!s.quitAfterSend,
    allLowercase: !!s.allLowercase
  });
}

function getContactDisplayName(contact) {
  var c = normalizeContact(contact);
  if (!c.name) {
    return '';
  }

  var emojiCode = c.emoji || CONTACT_EMOJI_DEFAULT_CODE;
  var emojiChar = emojiCharFromCode(emojiCode);

  return emojiChar ? (emojiChar + ' ' + c.name) : c.name;
}

function getSettings() {
  try {
    var parsed = JSON.parse(localStorage.getItem('settings')) || {};

    return {
      contacts: normalizeContacts(parsed.contacts),
      cannedMessages: normalizeCannedMessages(parsed.cannedMessages),
      graph: normalizeGraphForStorage(parsed.graph),
      targetEmail: String(parsed.targetEmail || ''),
      quitAfterSend: !!parsed.quitAfterSend,
      allLowercase: !!parsed.allLowercase
    };
  } catch (e) {
    return {
      contacts: [],
      cannedMessages: [],
      graph: normalizeGraphForStorage(null),
      targetEmail: '',
      quitAfterSend: false,
      allLowercase: false
    };
  }
}


function setSettings(s) {
  var source = s || {};
  var normalized = {
    contacts: normalizeContacts(source.contacts),
    cannedMessages: normalizeCannedMessages(source.cannedMessages),
    graph: normalizeGraphForStorage(source.graph),
    targetEmail: String(source.targetEmail || ''),
    quitAfterSend: !!source.quitAfterSend,
    allLowercase: !!source.allLowercase
  };

  localStorage.setItem('settings', JSON.stringify(normalized));
}

function getAuthState(settings) {
  var s = settings || getSettings();
  var graph = s.graph || {};
  var authConfig = getAuthConfig(s);

  if (authConfig.hasInvalidClientId) {
    return AUTH_STATE_REAUTH_REQUIRED;
  }

  if (!graph.accessToken && !graph.refreshToken) {
    return AUTH_STATE_REAUTH_REQUIRED;
  }

  if (graph.expiresAt && Date.now() >= graph.expiresAt && !graph.refreshToken) {
    return AUTH_STATE_REAUTH_REQUIRED;
  }

  return AUTH_STATE_OK;
}

function sendAuthStateToWatch(authState) {
  var state = typeof authState === 'number' ? authState : getAuthState(getSettings());
  var msg = {};
  msg[KEY_AUTH_STATE] = state;

  Pebble.sendAppMessage(msg,
    function() {
      console.log('Auth state sent: ' + state);
    },
    function(e) {
      console.log('Failed to send auth state: ' + JSON.stringify(e));
    }
  );
}


function sendContactsToWatch() {
  var s = getSettings();
  console.log('Current settings summary: ' + getSettingsLogSummary(s));
  console.log('Contacts length: ' + s.contacts.length);
  
  if (s.contacts.length === 0) {
    console.log('No contacts found, sending empty string');
  }
  
  var names = s.contacts.map(function(c) { return getContactDisplayName(c); }).join('\n');
  var authState = getAuthState(s);
  console.log('Sending contacts to watch: count=' + s.contacts.length + ', authState=' + authState);
  var msg = {};
  msg[KEY_CONTACT_NAMES] = names;
  msg[KEY_QUIT_AFTER_SEND] = s.quitAfterSend ? 1 : 0;
  msg[KEY_AUTH_STATE] = authState;
  Pebble.sendAppMessage(msg, 
    function() {
      console.log('Contacts sent successfully');
    }, 
    function(e) {
      console.log('Failed to send contacts: ' + JSON.stringify(e));
    }
  );
}

function sendCannedMessagesToWatch() {
  var s = getSettings();
  var labels = buildCannedLabelsPayload(s.cannedMessages);
  console.log('Sending canned labels to watch: count=' + normalizeCannedMessages(s.cannedMessages).length);

  var msg = {};
  msg[KEY_CANNED_LABELS] = labels;
  Pebble.sendAppMessage(msg,
    function() {
      console.log('Canned messages sent successfully');
    },
    function(e) {
      console.log('Failed to send canned messages: ' + JSON.stringify(e));
    }
  );
}


Pebble.addEventListener('ready', function() {
  console.log('=== PKJS READY EVENT ===');
  console.log('Pebble object available: ' + (typeof Pebble !== 'undefined'));
  console.log('sendAppMessage available: ' + (typeof Pebble.sendAppMessage === 'function'));

  sendContactsToWatch();
  sendCannedMessagesToWatch();

  if (localStorage.getItem(DEBUG_HEARTBEAT_STORAGE_KEY) === '1') {
    setInterval(function() {
      console.log('=== JS HEARTBEAT === ' + new Date().toISOString());
    }, 10000);
  }
});

// OAuth 2.0 Configuration for Public Client (PKCE Flow)
var OAUTH_CONFIG = {
  clientId: 'b9260194-8028-48ae-8907-e30182eda409', // Shared default client ID (BYO override available in config page)
  tenantId: 'common', // Use 'common' for multi-tenant, or your specific tenant ID
  redirectUri: 'https://mattnovelli.github.io/patch/', // Hosted OAuth receiver page (GitHub Pages /docs)
  scope: 'https://graph.microsoft.com/Mail.Send offline_access',
  responseType: 'code', // Using authorization code with PKCE
  responseMode: 'query' // Authorization code callback in query params
};

// Hosted configuration page URL (typically a GitHub Pages URL).
// This page should handle OAuth and return settings via pebblejs://close#<json>
var CONFIG_PAGE_URL = OAUTH_CONFIG.redirectUri;

function normalizeClientId(clientId) {
  var v = String(clientId || '').trim();
  if (!v || v === OAUTH_CONFIG.clientId || /^YOUR_/i.test(v)) {
    return OAUTH_CONFIG.clientId;
  }

  var guidPattern = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
  return guidPattern.test(v) ? v : OAUTH_CONFIG.clientId;
}

function normalizeTenantId(tenantId) {
  var v = String(tenantId || '').trim();
  if (!v || /^YOUR_/i.test(v)) {
    return OAUTH_CONFIG.tenantId;
  }

  return v;
}

function createTokenError(code, message, details) {
  var err = details || {};
  err.code = code;
  err.message = message;
  err.retryable = !!err.retryable;
  err.requiresReauth = !!err.requiresReauth;
  return err;
}

function getTokenErrorMessage(error) {
  if (!error) {
    return 'Authentication failed - please sign in again';
  }

  if (typeof error === 'string') {
    return error;
  }

  if (error.requiresReauth) {
    return error.message || 'Session expired - open settings and sign in again';
  }

  if (error.retryable) {
    return error.message || 'Temporary authentication issue. Please try again.';
  }

  return error.message || 'Authentication failed - please sign in again';
}

function getAuthConfig(settings) {
  var graph = (settings && settings.graph) || {};
  var rawClientId = String(graph.clientId || '').trim();
  var normalizedClientId = normalizeClientId(rawClientId);
  var customClientProvided = !!rawClientId && rawClientId !== OAUTH_CONFIG.clientId;
  var invalidStoredCustomClient = customClientProvided && rawClientId.toLowerCase() !== normalizedClientId.toLowerCase();

  return {
    clientId: normalizedClientId,
    tenantId: normalizeTenantId(graph.tenantId),
    redirectUri: String(graph.redirectUri || OAUTH_CONFIG.redirectUri),
    scope: (graph.scope || OAUTH_CONFIG.scope),
    hasInvalidClientId: invalidStoredCustomClient
  };
}

function getOriginFromUri(uri) {
  var value = String(uri || '').trim();
  if (!value) {
    return '';
  }

  try {
    if (typeof URL === 'function') {
      return new URL(value).origin;
    }
  } catch (e) {
    // Fall through to regex fallback for runtimes without URL support.
  }

  var match = value.match(/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\/[^\/?#]+/);
  return match ? match[0] : '';
}

function setTokenRequestHeaders(xhr, redirectUri) {
  xhr.setRequestHeader('Content-Type', 'application/x-www-form-urlencoded');

  var origin = getOriginFromUri(redirectUri || OAUTH_CONFIG.redirectUri);
  if (!origin) {
    return;
  }

  try {
    xhr.setRequestHeader('Origin', origin);
    console.log('Token request Origin header set: ' + origin);
  } catch (e) {
    console.log('Token request Origin header unavailable: ' + e);
  }
}

function queueRefreshWaiter(callback) {
  s_refreshWaiters.push(callback);
}

function flushRefreshWaiters(error, accessToken) {
  var waiters = s_refreshWaiters.slice();
  s_refreshWaiters = [];
  s_refreshInFlight = false;

  for (var i = 0; i < waiters.length; i++) {
    try {
      waiters[i](error, accessToken);
    } catch (e) {
      console.log('Refresh waiter callback failed: ' + e);
    }
  }
}

function parseTokenEndpointFailure(status, responseText, options) {
  var opts = options || {};
  var parsed = null;
  var errorCode = '';
  var errorDescription = '';

  if (responseText) {
    try {
      parsed = JSON.parse(responseText);
    } catch (e) {
      parsed = null;
    }
  }

  if (parsed) {
    errorCode = String(parsed.error || '').toLowerCase();
    errorDescription = String(parsed.error_description || '');
  }

  var normalizedDescription = errorDescription.toLowerCase();
  var isSpaRefreshRestriction =
    errorCode === 'invalid_request' &&
    (normalizedDescription.indexOf('aadsts9002326') !== -1 ||
      normalizedDescription.indexOf('aadsts90023') !== -1 ||
      normalizedDescription.indexOf('single-page application') !== -1 ||
      normalizedDescription.indexOf('cross-origin requests') !== -1 ||
      normalizedDescription.indexOf('cross-origin token redemption') !== -1);
  var retryable = status === 0 || status === 408 || status === 429 || status >= 500 ||
    errorCode === 'temporarily_unavailable' || errorCode === 'server_error' || errorCode === 'timeout';
  var requiresReauth = status === 401 || status === 403 ||
    errorCode === 'invalid_grant' || errorCode === 'interaction_required' ||
    errorCode === 'login_required' ||
    errorCode === 'invalid_client' || errorCode === 'unauthorized_client' ||
    errorCode === 'consent_required' ||
    isSpaRefreshRestriction ||
    (status === 400 && normalizedDescription.indexOf('invalid_grant') !== -1);

  var reauthMessage = opts.reauthMessage || 'Session expired - open settings and sign in again';
  if (isSpaRefreshRestriction) {
    reauthMessage = opts.spaRestrictionMessage ||
      'Sign-in blocked by Entra app type - configure the app as Web/native (not SPA-only) and sign in again';
  }

  if (requiresReauth) {
    return createTokenError('reauth_required', reauthMessage, {
      status: status,
      errorCode: errorCode,
      errorDescription: errorDescription,
      isSpaRestriction: isSpaRefreshRestriction,
      responseText: responseText || '',
      requiresReauth: true
    });
  }

  if (retryable) {
    return createTokenError(opts.retryCode || 'token_retryable', opts.retryMessage || 'Temporary network/auth service issue while requesting token', {
      status: status,
      errorCode: errorCode,
      errorDescription: errorDescription,
      responseText: responseText || '',
      retryable: true
    });
  }

  return createTokenError(opts.failureCode || 'token_failed', (opts.failureMessagePrefix || 'Token request failed') + ' (HTTP ' + status + ')', {
    status: status,
    errorCode: errorCode,
    errorDescription: errorDescription,
    responseText: responseText || ''
  });
}

function parseRefreshFailure(status, responseText) {
  return parseTokenEndpointFailure(status, responseText, {
    reauthMessage: 'Session expired - open settings and sign in again',
    spaRestrictionMessage: 'Token refresh blocked by Entra app type - configure the app as Web/native (not SPA-only) and sign in again',
    retryCode: 'refresh_retryable',
    retryMessage: 'Temporary network/auth service issue while refreshing sign-in',
    failureCode: 'refresh_failed',
    failureMessagePrefix: 'Token refresh failed'
  });
}

function parseCodeRedeemFailure(status, responseText) {
  return parseTokenEndpointFailure(status, responseText, {
    reauthMessage: 'Sign-in could not be completed - open settings and sign in again',
    spaRestrictionMessage: 'Sign-in blocked by Entra app type - configure the app as Web/native (not SPA-only) and sign in again',
    retryCode: 'redeem_retryable',
    retryMessage: 'Temporary network/auth service issue while completing sign-in',
    failureCode: 'redeem_failed',
    failureMessagePrefix: 'Authorization code redemption failed'
  });
}

function getRefreshRetryDelayMs(attemptNumber) {
  return TOKEN_REFRESH_BASE_RETRY_MS * Math.pow(2, attemptNumber - 1);
}

function buildConfigPageSettingsPayload(settings, authConfig) {
  var source = settings || {};
  return {
    contacts: normalizeContacts(source.contacts),
    cannedMessages: normalizeCannedMessages(source.cannedMessages),
    graph: {
      clientId: authConfig.clientId,
      tenantId: authConfig.tenantId,
      redirectUri: authConfig.redirectUri,
      scope: authConfig.scope
    },
    targetEmail: String(source.targetEmail || ''),
    quitAfterSend: !!source.quitAfterSend,
    allLowercase: !!source.allLowercase
  };
}

function buildConfigPageUrl(settings, authConfig, options) {
  var opts = options || {};
  var authState = typeof opts.authState === 'number' ? opts.authState : getAuthState(settings);
  var autoPersist = typeof opts.autoPersist === 'undefined'
    ? authState === AUTH_STATE_REAUTH_REQUIRED
    : !!opts.autoPersist;
  var payload = buildConfigPageSettingsPayload(settings, authConfig);

  var sep = CONFIG_PAGE_URL.indexOf('?') === -1 ? '?' : '&';
  var parts = [
    't=' + Date.now(),
    'settings=' + encodeURIComponent(JSON.stringify(payload)),
    'client_id=' + encodeURIComponent(authConfig.clientId),
    'tenant=' + encodeURIComponent(authConfig.tenantId),
    'scope=' + encodeURIComponent(authConfig.scope),
    'auth_state=' + authState,
    'auto_persist=' + (autoPersist ? '1' : '0')
  ];

  return CONFIG_PAGE_URL + sep + parts.join('&');
}

function applyTokenDataToSettings(settings, tokenData, authConfig) {
  var sourceSettings = settings || getSettings();
  var sourceGraph = sourceSettings.graph || {};
  var cfg = authConfig || {};
  var expiresIn = Number(tokenData.expiresIn || sourceGraph.expiresIn || 0);
  var expiresAt = Number(tokenData.expiresAt || 0);

  if (!expiresAt) {
    expiresAt = Date.now() + ((expiresIn || 3600) * 1000);
  }

  sourceSettings.graph = {
    accessToken: String(tokenData.accessToken || sourceGraph.accessToken || ''),
    refreshToken: String(tokenData.refreshToken || sourceGraph.refreshToken || ''),
    expiresIn: expiresIn,
    tokenType: String(tokenData.tokenType || sourceGraph.tokenType || 'Bearer'),
    scope: String(tokenData.scope || cfg.scope || sourceGraph.scope || OAUTH_CONFIG.scope),
    clientId: String(tokenData.clientId || cfg.clientId || sourceGraph.clientId || OAUTH_CONFIG.clientId),
    tenantId: String(tokenData.tenantId || cfg.tenantId || sourceGraph.tenantId || OAUTH_CONFIG.tenantId),
    redirectUri: String(tokenData.redirectUri || cfg.redirectUri || sourceGraph.redirectUri || OAUTH_CONFIG.redirectUri),
    expiresAt: expiresAt
  };

  return sourceSettings;
}

// Refresh access token using refresh token
function refreshAccessToken(authConfig, refreshToken, callback) {
  console.log('Refreshing access token...');
  console.log('Refresh context: client=' + authConfig.clientId + ', tenant=' + authConfig.tenantId);
  
  var tokenUrl = 'https://login.microsoftonline.com/' + authConfig.tenantId + '/oauth2/v2.0/token';
  var body = [
    'client_id=' + encodeURIComponent(authConfig.clientId),
    'scope=' + encodeURIComponent(authConfig.scope),
    'refresh_token=' + encodeURIComponent(refreshToken),
    'grant_type=refresh_token'
  ].join('&');
  
  var xhr = new XMLHttpRequest();
  var completed = false;

  function finish(error, tokenData) {
    if (completed) {
      return;
    }

    completed = true;
    callback(error, tokenData);
  }

  xhr.open('POST', tokenUrl);
  xhr.timeout = TOKEN_REFRESH_TIMEOUT_MS;
  setTokenRequestHeaders(xhr, authConfig.redirectUri);
  
  xhr.onreadystatechange = function() {
    if (xhr.readyState !== 4) {
      return;
    }

    console.log('Token refresh response status: ' + xhr.status);
      
    if (xhr.status === 200) {
      try {
        var response = JSON.parse(xhr.responseText);

        if (!response.access_token) {
          finish(createTokenError('refresh_parse', 'Failed to parse refresh response', {
            responseText: xhr.responseText
          }));
          return;
        }

        console.log('Token refresh successful');
        finish(null, {
          accessToken: response.access_token,
          refreshToken: response.refresh_token || refreshToken,
          expiresIn: response.expires_in || 3600,
          tokenType: response.token_type,
          scope: response.scope || authConfig.scope,
          clientId: authConfig.clientId,
          tenantId: authConfig.tenantId,
          redirectUri: authConfig.redirectUri,
          expiresAt: Date.now() + ((response.expires_in || 3600) * 1000)
        });
      } catch (e) {
        console.log('Error parsing refresh response: ' + e);
        finish(createTokenError('refresh_parse', 'Failed to parse refresh response', {
          responseText: xhr.responseText
        }));
      }
    } else {
      console.log('Token refresh failed body: ' + xhr.responseText);
      finish(parseRefreshFailure(xhr.status, xhr.responseText));
    }
  };

  xhr.onerror = function() {
    console.log('Token refresh network error');
    finish(createTokenError('refresh_network', 'Temporary network/auth service issue while refreshing sign-in', {
      retryable: true,
      status: 0
    }));
  };

  xhr.ontimeout = function() {
    console.log('Token refresh request timed out');
    finish(createTokenError('refresh_timeout', 'Temporary network/auth service issue while refreshing sign-in', {
      retryable: true,
      status: 0
    }));
  };
  
  xhr.send(body);
}

function refreshAccessTokenWithRetry(authConfig, refreshToken, callback) {
  function runAttempt(attemptNumber) {
    console.log('Token refresh attempt ' + attemptNumber + ' of ' + TOKEN_REFRESH_MAX_ATTEMPTS);

    refreshAccessToken(authConfig, refreshToken, function(error, tokens) {
      if (!error) {
        callback(null, tokens);
        return;
      }

      var shouldRetry = error.retryable && attemptNumber < TOKEN_REFRESH_MAX_ATTEMPTS;
      if (!shouldRetry) {
        callback(error);
        return;
      }

      var delayMs = getRefreshRetryDelayMs(attemptNumber);
      console.log('Retryable refresh failure (' + error.code + '), retrying in ' + delayMs + 'ms');
      setTimeout(function() {
        runAttempt(attemptNumber + 1);
      }, delayMs);
    });
  }

  runAttempt(1);
}

function redeemAuthorizationCode(authPayload, callback) {
  console.log('Redeeming authorization code in PKJS runtime...');
  console.log('Redeem context: client=' + authPayload.clientId + ', tenant=' + authPayload.tenantId);

  var tokenUrl = 'https://login.microsoftonline.com/' + authPayload.tenantId + '/oauth2/v2.0/token';
  var body = [
    'client_id=' + encodeURIComponent(authPayload.clientId),
    'scope=' + encodeURIComponent(authPayload.scope),
    'code=' + encodeURIComponent(authPayload.code),
    'redirect_uri=' + encodeURIComponent(authPayload.redirectUri),
    'grant_type=authorization_code',
    'code_verifier=' + encodeURIComponent(authPayload.codeVerifier)
  ].join('&');

  var xhr = new XMLHttpRequest();
  var completed = false;

  function finish(error, tokenData) {
    if (completed) {
      return;
    }

    completed = true;
    callback(error, tokenData);
  }

  xhr.open('POST', tokenUrl);
  xhr.timeout = TOKEN_REFRESH_TIMEOUT_MS;
  setTokenRequestHeaders(xhr, authPayload.redirectUri);

  xhr.onreadystatechange = function() {
    if (xhr.readyState !== 4) {
      return;
    }

    console.log('Authorization code redemption response status: ' + xhr.status);

    if (xhr.status === 200) {
      try {
        var response = JSON.parse(xhr.responseText);

        if (!response.access_token) {
          finish(createTokenError('redeem_parse', 'Failed to parse sign-in response', {
            responseText: xhr.responseText
          }));
          return;
        }

        finish(null, {
          accessToken: response.access_token,
          refreshToken: response.refresh_token || '',
          expiresIn: response.expires_in || 3600,
          tokenType: response.token_type,
          scope: response.scope || authPayload.scope,
          clientId: authPayload.clientId,
          tenantId: authPayload.tenantId,
          redirectUri: authPayload.redirectUri,
          expiresAt: Date.now() + ((response.expires_in || 3600) * 1000)
        });
      } catch (e) {
        console.log('Error parsing code redemption response: ' + e);
        finish(createTokenError('redeem_parse', 'Failed to parse sign-in response', {
          responseText: xhr.responseText
        }));
      }
    } else {
      console.log('Authorization code redemption failed body: ' + xhr.responseText);
      finish(parseCodeRedeemFailure(xhr.status, xhr.responseText));
    }
  };

  xhr.onerror = function() {
    console.log('Authorization code redemption network error');
    finish(createTokenError('redeem_network', 'Temporary network/auth service issue while completing sign-in', {
      retryable: true,
      status: 0
    }));
  };

  xhr.ontimeout = function() {
    console.log('Authorization code redemption timed out');
    finish(createTokenError('redeem_timeout', 'Temporary network/auth service issue while completing sign-in', {
      retryable: true,
      status: 0
    }));
  };

  xhr.send(body);
}

function redeemAuthorizationCodeWithRetry(authPayload, callback) {
  function runAttempt(attemptNumber) {
    console.log('Authorization code redemption attempt ' + attemptNumber + ' of ' + TOKEN_REFRESH_MAX_ATTEMPTS);

    redeemAuthorizationCode(authPayload, function(error, tokens) {
      if (!error) {
        callback(null, tokens);
        return;
      }

      var shouldRetry = error.retryable && attemptNumber < TOKEN_REFRESH_MAX_ATTEMPTS;
      if (!shouldRetry) {
        callback(error);
        return;
      }

      var delayMs = getRefreshRetryDelayMs(attemptNumber);
      console.log('Retryable redemption failure (' + error.code + '), retrying in ' + delayMs + 'ms');
      setTimeout(function() {
        runAttempt(attemptNumber + 1);
      }, delayMs);
    });
  }

  runAttempt(1);
}

// Check if token needs refresh and refresh if necessary
function ensureValidToken(callback) {
  var settings = getSettings();
  var authConfig = getAuthConfig(settings);
  var graph = settings.graph || {};
  
  if (!graph.accessToken && !graph.refreshToken) {
    callback(createTokenError('missing_access_token', 'Not signed in - open settings and sign in again', {
      requiresReauth: true
    }));
    return;
  }

  if (authConfig.hasInvalidClientId) {
    callback(createTokenError('invalid_client_config', 'Saved custom Client ID is invalid - open settings and sign in again', {
      requiresReauth: true
    }));
    return;
  }
  
  // Check if token is expired or will expire soon.
  var now = Date.now();
  var expiresAt = graph.expiresAt || 0;
  var shouldRefresh = !graph.accessToken || !expiresAt || (now + TOKEN_REFRESH_BUFFER_MS >= expiresAt);
  
  if (!shouldRefresh) {
    console.log('Token is still valid. Expires in ' + Math.round((expiresAt - now) / 1000) + 's');
    sendAuthStateToWatch(AUTH_STATE_OK);
    callback(null, graph.accessToken);
    return;
  }

  console.log('Token refresh needed. now=' + now + ', expiresAt=' + expiresAt + ', bufferMs=' + TOKEN_REFRESH_BUFFER_MS);

  if (!graph.refreshToken) {
    callback(createTokenError('missing_refresh_token', 'Session expired - open settings and sign in again', {
      requiresReauth: true
    }));
    return;
  }

  if (s_refreshInFlight) {
    console.log('A token refresh is already in progress; joining existing refresh');
    queueRefreshWaiter(callback);
    return;
  }

  console.log('Refreshing token directly in PKJS runtime');
  s_refreshInFlight = true;
  queueRefreshWaiter(callback);

  refreshAccessTokenWithRetry(authConfig, graph.refreshToken, function(error, tokens) {
    if (error) {
      console.log('Token refresh failed in PKJS: ' + JSON.stringify(error));
      if (error.requiresReauth) {
        sendAuthStateToWatch(AUTH_STATE_REAUTH_REQUIRED);
      }
      flushRefreshWaiters(error, null);
      return;
    }

    var latestSettings = getSettings();
    var mergedSettings = applyTokenDataToSettings(latestSettings, tokens, authConfig);
    setSettings(mergedSettings);

    sendAuthStateToWatch(AUTH_STATE_OK);
    flushRefreshWaiters(null, tokens.accessToken);
  });
}

// Hosted configuration page approach (GitHub Pages, custom domain, etc.)
Pebble.addEventListener('showConfiguration', function() {
  console.log('showConfiguration fired - opening hosted config page');
  var settings = getSettings();
  var authConfig = getAuthConfig(settings);
  var authState = getAuthState(settings);
  var configURL = buildConfigPageUrl(settings, authConfig, {
    authState: authState
  });

  console.log('Opening config URL (query redacted)');
  Pebble.openURL(configURL);
});


function extractGraphAuthPayloadFromSettings(settings) {
  var payload = settings && settings.graphAuth;
  if (!payload || typeof payload !== 'object') {
    return null;
  }

  var sourceGraph = (settings && settings.graph) || {};
  var code = String(payload.code || '').trim();
  var codeVerifier = String(payload.codeVerifier || '').trim();
  var redirectUri = String(payload.redirectUri || '').trim();

  if (!code || !codeVerifier || !redirectUri) {
    return null;
  }

  return {
    code: code,
    codeVerifier: codeVerifier,
    redirectUri: redirectUri,
    state: String(payload.state || ''),
    clientId: normalizeClientId(payload.clientId || sourceGraph.clientId),
    tenantId: normalizeTenantId(payload.tenantId || sourceGraph.tenantId),
    scope: String(payload.scope || sourceGraph.scope || OAUTH_CONFIG.scope)
  };
}

function mergePersistedSettingsFromConfigResponse(newSettings) {
  var incoming = newSettings || {};
  var existing = getSettings();
  var existingGraph = existing.graph || {};
  var incomingGraph = incoming.graph || {};

  var nextClientId = normalizeClientId(incomingGraph.clientId || existingGraph.clientId);
  var nextTenantId = normalizeTenantId(incomingGraph.tenantId || existingGraph.tenantId);
  var nextRedirectUri = String(incomingGraph.redirectUri || existingGraph.redirectUri || OAUTH_CONFIG.redirectUri);
  var nextScope = String(incomingGraph.scope || existingGraph.scope || OAUTH_CONFIG.scope);

  var existingClientId = normalizeClientId(existingGraph.clientId || OAUTH_CONFIG.clientId);
  var existingTenantId = normalizeTenantId(existingGraph.tenantId || OAUTH_CONFIG.tenantId);
  var existingScope = String(existingGraph.scope || OAUTH_CONFIG.scope);

  var authConfigChanged =
    nextClientId !== existingClientId ||
    nextTenantId !== existingTenantId ||
    nextScope !== existingScope;

  var merged = {
    contacts: normalizeContacts(incoming.contacts),
    cannedMessages: normalizeCannedMessages(typeof incoming.cannedMessages === 'undefined'
      ? existing.cannedMessages
      : incoming.cannedMessages),
    graph: normalizeGraphForStorage(existingGraph),
    targetEmail: String(incoming.targetEmail || ''),
    quitAfterSend: !!incoming.quitAfterSend,
    allLowercase: !!incoming.allLowercase
  };

  merged.graph.clientId = nextClientId;
  merged.graph.tenantId = nextTenantId;
  merged.graph.redirectUri = nextRedirectUri;
  merged.graph.scope = nextScope;

  if (authConfigChanged) {
    merged.graph.accessToken = '';
    merged.graph.refreshToken = '';
    merged.graph.expiresIn = 0;
    merged.graph.tokenType = '';
    merged.graph.expiresAt = 0;
  }

  return merged;
}

// Handle configuration results
Pebble.addEventListener('webviewclosed', function(e) {
  console.log('=== Configuration closed ===');
  console.log('Response received: ' + (e.response ? 'yes' : 'no'));

  var parsedSettings = null;
  var authPayload = null;

  if (e.response) {
    try {
      var newSettings = JSON.parse(decodeURIComponent(e.response));
      newSettings.quitAfterSend = !!newSettings.quitAfterSend;
      newSettings.allLowercase = !!newSettings.allLowercase;

      authPayload = extractGraphAuthPayloadFromSettings(newSettings);
      if (newSettings.graphAuth) {
        delete newSettings.graphAuth;
      }

      var mergedSettings = mergePersistedSettingsFromConfigResponse(newSettings);
      console.log('New settings summary: ' + getSettingsLogSummary(mergedSettings));
      setSettings(mergedSettings);
      sendContactsToWatch();
      sendCannedMessagesToWatch();
      parsedSettings = mergedSettings;
    } catch (error) {
      console.log('Error parsing config response: ' + error);
    }
  }

  if (!authPayload) {
    return;
  }

  redeemAuthorizationCodeWithRetry(authPayload, function(error, tokens) {
    if (error) {
      console.log('Authorization code redemption failed: ' + JSON.stringify(error));

      if (error.requiresReauth) {
        sendAuthStateToWatch(AUTH_STATE_REAUTH_REQUIRED);
      }

      var errorMsg = {};
      errorMsg[KEY_ERROR] = getTokenErrorMessage(error);
      Pebble.sendAppMessage(errorMsg);
      return;
    }

    var latestSettings = parsedSettings || getSettings();
    var authConfig = {
      clientId: authPayload.clientId,
      tenantId: authPayload.tenantId,
      scope: authPayload.scope
    };
    var mergedSettings = applyTokenDataToSettings(latestSettings, tokens, authConfig);
    setSettings(mergedSettings);

    sendAuthStateToWatch(AUTH_STATE_OK);

    var statusMsg = {};
    statusMsg[KEY_STATUS] = 'Sign-in complete';
    Pebble.sendAppMessage(statusMsg);
  });
});

console.log('=== JAVASCRIPT FILE FULLY LOADED ===');