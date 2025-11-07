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
    msg[KEY_ERROR] = 'Missing access token - check settings';
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
  console.log('Target email: ' + s.targetEmail);
  console.log('Voice transcription: ' + text);

  // Create the JSON object for SMS processing
  var messageData = {
    recipient: contact.name,
    message: text
  };

  var emailBody = JSON.stringify(messageData);
  console.log('JSON payload: ' + emailBody);

  // Construct Graph sendMail payload
  var body = {
    message: {
      subject: 'NEW TEXT MESSAGE',
      body: { contentType: 'Text', content: emailBody },
      toRecipients: [ { emailAddress: { address: s.targetEmail } } ]
    },
    saveToSentItems: true
  };

  console.log('Sending email via Microsoft Graph...');
  console.log('Request URL: https://graph.microsoft.com/v1.0/me/sendMail');
  console.log('Request headers: Authorization: Bearer ' + s.graph.accessToken.substring(0, 20) + '...');
  console.log('Request body: ' + JSON.stringify(body, null, 2));
  
  // Check if fetch is available
  console.log('Fetch function available: ' + (typeof fetch === 'function'));
  console.log('Promise available: ' + (typeof Promise === 'function'));
  console.log('XMLHttpRequest available: ' + (typeof XMLHttpRequest === 'function'));
  
  if (typeof fetch !== 'function') {
    console.log('ERROR: fetch is not available, trying XMLHttpRequest...');
    
    if (typeof XMLHttpRequest !== 'function') {
      console.log('ERROR: XMLHttpRequest also not available');
      var msg = {};
      msg[KEY_ERROR] = 'Network API not available';
      Pebble.sendAppMessage(msg);
      return;
    }
    
    // Use XMLHttpRequest instead
    console.log('Using XMLHttpRequest fallback...');
    
    var xhr = new XMLHttpRequest();
    xhr.open('GET', 'https://graph.microsoft.com/v1.0/me');
    xhr.setRequestHeader('Authorization', 'Bearer ' + s.graph.accessToken);
    
    xhr.onreadystatechange = function() {
      console.log('XHR readyState: ' + xhr.readyState + ', status: ' + xhr.status);
      
      if (xhr.readyState === 4) {
        if (xhr.status === 200) {
          console.log('Token validation successful via XHR');
          console.log('Response: ' + xhr.responseText);
          
          // Now try to send the actual email
          var emailXhr = new XMLHttpRequest();
          emailXhr.open('POST', 'https://graph.microsoft.com/v1.0/me/sendMail');
          emailXhr.setRequestHeader('Authorization', 'Bearer ' + s.graph.accessToken);
          emailXhr.setRequestHeader('Content-Type', 'application/json');
          
          emailXhr.onreadystatechange = function() {
            console.log('Email XHR readyState: ' + emailXhr.readyState + ', status: ' + emailXhr.status);
            
            if (emailXhr.readyState === 4) {
              if (emailXhr.status === 202 || emailXhr.status === 200) {
                console.log('SUCCESS: Email sent via XHR');
                var msg = {};
                msg[KEY_STATUS] = 'Email sent to ' + contact.name + '!';
                Pebble.sendAppMessage(msg);
              } else {
                console.log('ERROR: Email failed via XHR - ' + emailXhr.status + ': ' + emailXhr.responseText);
                var msg = {};
                msg[KEY_ERROR] = 'Email failed: HTTP ' + emailXhr.status;
                Pebble.sendAppMessage(msg);
              }
            }
          };
          
          emailXhr.send(JSON.stringify(body));
        } else {
          console.log('Token validation failed via XHR: ' + xhr.status + ': ' + xhr.responseText);
          var msg = {};
          msg[KEY_ERROR] = 'Token validation failed';
          Pebble.sendAppMessage(msg);
        }
      }
    };
    
    xhr.send();
    return;
  }
  
  // Send status update to watch
  var statusMsg = {};
  statusMsg[KEY_STATUS] = 'Sending email...';
  Pebble.sendAppMessage(statusMsg);

  // First, test the access token by getting user info
  console.log('Testing access token with /me endpoint...');
  
  // Add immediate error catching
  var testPromise = fetch('https://graph.microsoft.com/v1.0/me', {
    method: 'GET',
    headers: {
      'Authorization': 'Bearer ' + s.graph.accessToken
    }
  });
  
  console.log('Fetch promise created, waiting for response...');
  
  testPromise
  testPromise
  .then(function(testResp) {
    console.log('=== RECEIVED RESPONSE FROM /me ENDPOINT ===');
    console.log('Token test response status: ' + testResp.status);
    console.log('Token test response headers: ' + JSON.stringify(Array.from(testResp.headers.entries())));
    
    if (testResp.status !== 200) {
      return testResp.text().then(function(errorText) {
        console.log('Token test error body: ' + errorText);
        throw new Error('Token validation failed with status ' + testResp.status + ': ' + errorText);
      });
    }
    return testResp.json();
  })
  .catch(function(err) {
    console.log('=== ERROR IN TOKEN TEST ===');
    console.log('Token test failed immediately: ' + err);
    console.log('Error type: ' + typeof err);
    console.log('Error message: ' + (err.message || 'No message'));
    console.log('Error stack: ' + (err.stack || 'No stack'));
    
    // Try to send error to watch
    var msg = {};
    msg[KEY_ERROR] = 'Network error - cannot reach Microsoft Graph';
    Pebble.sendAppMessage(msg);
    
    throw err; // Re-throw to stop the chain
  })
  .then(function(userInfo) {
    console.log('Token valid! User: ' + (userInfo.displayName || userInfo.userPrincipalName));
    console.log('User info: ' + JSON.stringify(userInfo, null, 2));
    console.log('Now sending actual email...');
    
    // Create a timeout promise
    var timeoutPromise = new Promise(function(resolve, reject) {
      setTimeout(function() {
        console.log('TIMEOUT: Email request timed out after 30 seconds');
        reject(new Error('Request timeout after 30 seconds'));
      }, 30000);
    });

    // Create the fetch promise
    var fetchPromise = fetch('https://graph.microsoft.com/v1.0/me/sendMail', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + s.graph.accessToken,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    })
    .then(function(emailResp) {
      console.log('Email API response status: ' + emailResp.status);
      console.log('Email API response headers: ' + JSON.stringify(Array.from(emailResp.headers.entries())));
      
      if (emailResp.status === 202 || emailResp.status === 200) {
        console.log('SUCCESS: Email sent successfully');
        return { success: true, status: emailResp.status };
      } else {
        return emailResp.text().then(function(errorText) {
          console.log('Email API error body: ' + errorText);
          throw new Error('HTTP ' + emailResp.status + ': ' + errorText);
        });
      }
    });

    // Race between fetch and timeout
    return Promise.race([fetchPromise, timeoutPromise]);
  })
  .then(function(result) {
    console.log('Email sending completed successfully!');
    console.log('Final result: ' + JSON.stringify(result));
    
    var msg = {};
    msg[KEY_STATUS] = 'Email sent to ' + contact.name + '!';
    Pebble.sendAppMessage(msg);
  })
  .catch(function(err) {
    console.log('ERROR: Email sending failed');
    console.log('Error details: ' + err);
    
    var errorMsg = String(err && err.message || err);
    if (errorMsg.includes('Token validation failed')) {
      errorMsg = 'Access token expired or invalid';
    } else if (errorMsg.includes('401') || errorMsg.includes('unauthorized')) {
      errorMsg = 'Invalid access token';
    } else if (errorMsg.includes('403') || errorMsg.includes('forbidden')) {
      errorMsg = 'Permission denied - check token scope';
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
  });
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

// Traditional Pebble configuration approach
Pebble.addEventListener('showConfiguration', function() {
  console.log('showConfiguration fired - opening config page');
  var settings = getSettings();
  var configData = encodeURIComponent(JSON.stringify(settings));
  
  // Use a simple hosted configuration page
  var configURL = 'data:text/html;charset=utf-8,' + encodeURIComponent(`
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Graph Mailer Config</title>
    <style>
        body { font-family: Arial, sans-serif; padding: 20px; background: #f5f5f5; }
        .form { background: white; padding: 20px; border-radius: 8px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
        .field { margin-bottom: 15px; }
        label { display: block; margin-bottom: 5px; font-weight: bold; }
        input { width: 100%; padding: 10px; border: 1px solid #ddd; border-radius: 4px; box-sizing: border-box; }
        input[type="password"] { font-family: monospace; }
        .section { margin-top: 30px; padding-top: 20px; border-top: 1px solid #eee; }
        .buttons { margin-top: 30px; text-align: center; }
        button { padding: 12px 24px; margin: 0 10px; border: none; border-radius: 4px; font-size: 16px; cursor: pointer; }
        .save { background: #007AFF; color: white; }
        .cancel { background: #8E8E93; color: white; }
    </style>
</head>
<body>
    <div class="form">
        <h1>Graph Mailer Configuration</h1>
        
        <div class="field">
            <label>Microsoft Graph Access Token</label>
            <input type="password" id="accessToken" placeholder="Enter your access token">
        </div>
        
        <div class="field">
            <label>Target Email Address</label>
            <input type="email" id="targetEmail" placeholder="recipient@example.com">
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
        function loadSettings() {
            try {
                var params = new URLSearchParams(window.location.search);
                var data = params.get('data');
                if (data) {
                    var settings = JSON.parse(decodeURIComponent(data));
                    document.getElementById('accessToken').value = settings.graph.accessToken || '';
                    document.getElementById('targetEmail').value = settings.targetEmail || '';
                    
                    for (var i = 0; i < settings.contacts.length && i < 3; i++) {
                        document.getElementById('contact' + (i+1) + 'Name').value = settings.contacts[i].name || '';
                        document.getElementById('contact' + (i+1) + 'Phone').value = settings.contacts[i].phone || '';
                    }
                }
            } catch (e) {
                console.log('Error loading settings: ' + e);
            }
        }
        
        function saveConfig() {
            var settings = {
                contacts: [],
                graph: {
                    accessToken: document.getElementById('accessToken').value
                },
                targetEmail: document.getElementById('targetEmail').value
            };
            
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