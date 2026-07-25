# Calendar Sync (Google/Outlook) Not Implemented (Issue #470)

The calendar sync functionality (Google Workspace / Outlook) remains missing from the application, despite being a scheduled feature.

## Issue Details
- The CRM lacks the capability to synchronize meetings, tasks with due dates, and reminders with external calendars.
- This creates an integration gap, forcing users to manually double-enter meeting schedules.

## Recommendation
Implement calendar sync providers using standard OAuth2 flows. Ensure two-way sync via webhooks (e.g. Google Calendar Push Notifications) or periodic polling if webhooks are not viable. Provide a robust configuration UI under tenant integrations.
