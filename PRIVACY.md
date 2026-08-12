# Skimline Privacy Policy

Last updated: August 12, 2026

Skimline is a Chrome side-panel extension that turns long YouTube videos into scannable summaries, timestamped idea maps, answers, and a locally saved insight library.

## Data Skimline processes

Skimline may process the following data only when needed to provide its user-facing features:

- The DeepSeek API key entered by the user.
- The URL, title, identifier, captions, and other visible context of the YouTube video the user asks Skimline to process.
- User actions and inputs inside Skimline, such as selected text, search terms, questions, requested summary language, and saved insights.
- Generated summaries, answers, task state, preferences, and insight-library records.

## How data is used

- The API key, generated results, preferences, caches, and insight-library records are stored locally in Chrome extension storage on the user’s device.
- When the user requests an AI-powered feature, Skimline sends the minimum necessary video context and user input directly from the extension to the DeepSeek API. The user’s API key is used only to authenticate that request.
- Skimline does not operate a developer-controlled backend that receives this data.
- Skimline does not sell user data, use it for advertising, determine creditworthiness, or transfer it for purposes unrelated to the extension’s single purpose.
- Skimline does not include analytics or behavioral advertising trackers.

Data sent to DeepSeek is subject to DeepSeek’s own terms and privacy practices. Users should review those terms before adding an API key.

## Permissions

Skimline uses Chrome permissions only to provide its core functionality:

- `storage` and `unlimitedStorage` keep the API key, summaries, task state, preferences, backups, and insight library on the device.
- `sidePanel` displays the Skimline interface beside the active YouTube video.
- `scripting` reads caption-track information from the active YouTube page when the user invokes Skimline.
- Access to YouTube is limited to reading the current video context, captions, and playback position and to seeking the video when the user selects a timestamp.
- Access to `api.deepseek.com` is limited to user-requested AI generation calls.

Skimline does not load or execute remote JavaScript or WebAssembly. All executable code is included in the extension package.

## Retention and user control

Locally stored data remains on the device until the user deletes it, imports a replacement backup, clears the extension’s storage, or removes the extension. Skimline provides export and import controls for the insight library. Users can stop AI requests at any time by removing their API key.

## Security

Skimline restricts local extension storage to trusted extension contexts where the Chrome platform supports that control. Release packages use an explicit file allowlist and exclude private keys, local configuration, tests, and development files.

## Changes

Material changes to this policy will be published in this file with an updated date.

## Contact

For privacy questions or requests, open an issue at:

https://github.com/Jimmy-Song/Skimline/issues
