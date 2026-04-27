![Patch](docs\img\patch-header.svg)

## Voice-to-Text Messaging for iOS

Patch harnesses the power of iOS automation to send text messages from your Pebble.

Patch requires the Apple Shortcuts app and a Microsoft Outlook account (yes, you read that right!). Since Outlook supports push notifications, and shortcuts supports sending text messages when an email comes in, we can combine the two to create a text-sending workflow!

The whole process takes less than 15 seconds and requires no
intervention after you hit send on the Pebble.

Patch signs in to Microsoft using a Microsoft Entra ID App Registration (formerly Azure Active Directory app registration). In practice, this is the OAuth app identity that tells Microsoft which app is requesting permission to send mail on your behalf via Microsoft Graph.

By default, Patch uses a shared Entra app to make setup fast. If you prefer to self-host, you can create your own Entra App Registration, add your hosted config page as a Single-page application (SPA) redirect URI, and grant delegated Graph permissions such as Mail.Send and offline_access. The app supports both options from the same settings flow.

For a full step-by-step self-host setup, see [patch/OAUTH_SETUP.md](patch/OAUTH_SETUP.md).

As the name implies, this is a hacky workaround, but it works! The official text response functionality on iOS should be coming soon to the EU as a result of Article 6(7) of the Digital Markets Act.
