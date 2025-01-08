# Daily Summary Automation

This automation runs daily at 20:00 to check for packages pending customs fees and sends a summary via WhatsApp.

## Features
- Fetches pending customs fee packages from 17track
- Generates a summary in Haiku format
- Sends WhatsApp message with total count and package codes
- Runs automatically at 20:00 daily

## Configuration
- API Key for Anthropic: Located in settings.js
- WhatsApp configuration: Update the phone number in settings.js
