- In IMAP Sent I am seeing inbox data
- In Nubo Meet -> When user selects Schedule for Later, then we should be able to invite people over email. We will create standard email template which will have Email Link, Agenda and other information we can take reference from Microsoft Team’s invite email. 
- In Nubo Meet -> If user selects Enable Recording, Recording of the meeting can be done, recording will be saved in R2, and on Nubo Meet page, user can access / download / watch this recordings. 
- In Nubo Drive, There is no option to create new files, Refer OnlyOffice and create new files which will then be stored in user’s Nubo Drive via Cloudflare R2. 
- When user shares a file, currently Share with user feature is not working, if he enters username@nubo.email ID this file should also be seen in other person’s drive, along with its permission wether the other user can just read or edit the document. 
- If user shares with link, and non logged in user sees 404 not found error. 
- In Nubo Drive we need to have a separate section Shared with Me, where user can see files, folder shared with him / her. 
- Notifications in IMAP is not working. 
- Support button is not working with Chatwoot
- In settings Signature is disabled.
- Remove community from upper right 3 dots. 
- AI Chat button is also not working
- Not able to send IMAP based emails Failed to load resource: the server responded with a status of 500 ()Understand this error
entry.client-CgA1JMrx.js:47 Failed to send email via SMTP: proxy request failed, cannot connect to the specified address
(anonymous) @ entry.client-CgA1JMrx.js:47Understand this error
entry.client-CgA1JMrx.js:47 Error sending email: TRPCClientError: Failed to send email via SMTP: proxy request failed, cannot connect to the specified address
    at _e.from (query-provider-DahQjO7m.js:1:24711)
    at query-provider-DahQjO7m.js:1:29889
- Not able to see push notifications, if it is functioning or not. 
- We want to build entire App for Desktop including Windows, MacOS, Linux and Create PWA


  For tomorrow, you can either:

  1. Copy this task list to give me:
  Remaining tasks for Nubo:
  1. Fix IMAP email sending (SMTP proxy error)
  2. Fix IMAP Notifications not working
  3. Add Nubo Meet Schedule for Later with email invites
  4. Add Nubo Meet Recording feature with R2 storage
  5. Add Nubo Drive file creation with OnlyOffice
  6. Fix Push notifications visibility
  7. Build Desktop apps and PWA
  2. Or just tell me "continue with remaining Nubo tasks" and I can check
  the git history and codebase to understand what's been done and what's
  pending.

  The code changes are all committed, so the codebase itself will show
  what's implemented.