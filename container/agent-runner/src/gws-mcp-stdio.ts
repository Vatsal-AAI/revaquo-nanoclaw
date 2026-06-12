#!/usr/bin/env node
/**
 * Google Workspace MCP Server (stdio transport)
 * Direct REST API calls to Gmail, Drive, Calendar, Docs, Sheets, Tasks.
 * Uses OAuth2 refresh token — no gws CLI or OS keyring needed inside containers.
 */

import * as crypto from 'node:crypto';
import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';

// --- Config ---
const CREDS_PATH = process.env.GWS_CREDENTIALS_PATH || '/workspace/extra/gws-config/credentials.json';
const IMPERSONATE_USER = process.env.GWS_IMPERSONATE_USER || ''; // for domain-wide delegation

// Scopes requested during service-account (domain-wide delegation) token exchange.
// These MUST be authorized for the service account's client ID in the Google
// Workspace Admin console (Security → Access and data control → API controls →
// Domain-wide delegation). Override with GWS_SCOPES (space-separated) to match a
// different authorized set. Ignored for plain OAuth "authorized_user" credentials.
const DEFAULT_SCOPES = [
  'https://www.googleapis.com/auth/gmail.modify',
  'https://www.googleapis.com/auth/drive',
  'https://www.googleapis.com/auth/calendar',
  'https://www.googleapis.com/auth/documents',
  'https://www.googleapis.com/auth/spreadsheets',
  'https://www.googleapis.com/auth/tasks',
];
const SCOPES = (process.env.GWS_SCOPES || DEFAULT_SCOPES.join(' ')).trim();

interface Credentials {
  type?: string;
  // OAuth2 "authorized_user" credentials (acts as the single user who authorized)
  client_id?: string;
  client_secret?: string;
  refresh_token?: string;
  // Service-account credentials (domain-wide delegation; impersonates IMPERSONATE_USER)
  client_email?: string;
  private_key?: string;
  token_uri?: string;
}

let creds!: Credentials; // assigned by loadCredentials() at init (or process exits)
let accessToken = '';
let tokenExpiry = 0;

function loadCredentials(): void {
  try {
    creds = JSON.parse(fs.readFileSync(CREDS_PATH, 'utf-8'));
  } catch (err) {
    process.stderr.write(`gws-mcp: Failed to load credentials from ${CREDS_PATH}: ${err}\n`);
    process.exit(1);
  }
}

function base64url(input: string | Buffer): string {
  return Buffer.from(input)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

// Service-account flow: sign a JWT and exchange it for an access token.
// When IMPERSONATE_USER is set, the JWT "sub" claim makes Google mint the token
// AS that user — this is what makes the agent act as support@myrawellness.in.
// Requires domain-wide delegation authorized for SCOPES on the SA's client ID.
async function getAccessTokenServiceAccount(): Promise<string> {
  const tokenUri = creds.token_uri || 'https://oauth2.googleapis.com/token';
  const nowSec = Math.floor(Date.now() / 1000);

  const header = { alg: 'RS256', typ: 'JWT' };
  const claim: Record<string, unknown> = {
    iss: creds.client_email,
    scope: SCOPES,
    aud: tokenUri,
    iat: nowSec,
    exp: nowSec + 3600,
  };
  if (IMPERSONATE_USER) claim.sub = IMPERSONATE_USER;

  const unsigned = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(claim))}`;
  const signature = base64url(
    crypto.createSign('RSA-SHA256').update(unsigned).sign(creds.private_key as string),
  );
  const assertion = `${unsigned}.${signature}`;

  const res = await fetch(tokenUri, {
    method: 'POST',
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Service-account token exchange failed: ${err}`);
  }

  const data = (await res.json()) as { access_token: string; expires_in: number };
  accessToken = data.access_token;
  tokenExpiry = Date.now() + (data.expires_in - 60) * 1000;
  return accessToken;
}

// OAuth2 "authorized_user" flow: refresh-token exchange (single shared identity).
async function getAccessTokenRefresh(): Promise<string> {
  const params = new URLSearchParams({
    client_id: creds.client_id as string,
    client_secret: creds.client_secret as string,
    refresh_token: creds.refresh_token as string,
    grant_type: 'refresh_token',
  });

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    body: params,
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Token refresh failed: ${err}`);
  }

  const data = (await res.json()) as { access_token: string; expires_in: number };
  accessToken = data.access_token;
  tokenExpiry = Date.now() + (data.expires_in - 60) * 1000;
  return accessToken;
}

async function getAccessToken(): Promise<string> {
  if (accessToken && Date.now() < tokenExpiry) return accessToken;
  const isServiceAccount = creds.type === 'service_account' || !!creds.private_key;
  return isServiceAccount
    ? getAccessTokenServiceAccount()
    : getAccessTokenRefresh();
}

async function gapi(url: string, options: RequestInit = {}): Promise<unknown> {
  const token = await getAccessToken();
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    ...(options.headers as Record<string, string> || {}),
  };
  if (options.body && !headers['Content-Type']) {
    headers['Content-Type'] = 'application/json';
  }

  const res = await fetch(url, { ...options, headers });
  const text = await res.text();

  if (!res.ok) {
    throw new Error(`Google API error (${res.status}): ${text.substring(0, 500)}`);
  }

  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

// --- MCP stdio transport ---
const rl = readline.createInterface({ input: process.stdin, terminal: false });
let buffer = '';

rl.on('line', (line: string) => {
  buffer += line;
  try {
    const msg = JSON.parse(buffer);
    buffer = '';
    handleMessage(msg);
  } catch {
    // incomplete JSON
  }
});

function send(msg: Record<string, unknown>): void {
  process.stdout.write(JSON.stringify(msg) + '\n');
}

// --- Tool definitions ---
const TOOLS = [
  {
    name: 'gmail_list_messages',
    description: 'List recent emails. Use query for search (e.g. "from:john subject:report is:unread"). Returns message IDs and snippets.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Gmail search query' },
        max_results: { type: 'number', description: 'Max messages (default 10)' },
      },
    },
  },
  {
    name: 'gmail_read_message',
    description: 'Read a specific email by ID. Returns subject, sender, date, and body.',
    inputSchema: {
      type: 'object',
      properties: { message_id: { type: 'string', description: 'Gmail message ID' } },
      required: ['message_id'],
    },
  },
  {
    name: 'gmail_send',
    description: 'Send an email.',
    inputSchema: {
      type: 'object',
      properties: {
        to: { type: 'string', description: 'Recipient email' },
        subject: { type: 'string', description: 'Subject' },
        body: { type: 'string', description: 'Body text' },
        cc: { type: 'string', description: 'CC (comma-separated)' },
      },
      required: ['to', 'subject', 'body'],
    },
  },
  {
    name: 'calendar_list_events',
    description: 'List upcoming calendar events.',
    inputSchema: {
      type: 'object',
      properties: {
        days_ahead: { type: 'number', description: 'Days ahead (default 7)' },
        max_results: { type: 'number', description: 'Max events (default 20)' },
        calendar_id: { type: 'string', description: 'Calendar ID (default "primary"). Use email address for shared calendars.' },
      },
    },
  },
  {
    name: 'calendar_create_event',
    description: 'Create a calendar event.',
    inputSchema: {
      type: 'object',
      properties: {
        summary: { type: 'string', description: 'Event title' },
        start: { type: 'string', description: 'Start ISO 8601 (e.g. 2026-03-26T10:00:00+05:30)' },
        end: { type: 'string', description: 'End ISO 8601' },
        description: { type: 'string', description: 'Description' },
        attendees: { type: 'string', description: 'Comma-separated emails' },
        location: { type: 'string', description: 'Location' },
      },
      required: ['summary', 'start', 'end'],
    },
  },
  {
    name: 'drive_search',
    description: 'Search Google Drive files by name or query.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search term (searches file names)' },
        max_results: { type: 'number', description: 'Max files (default 20)' },
      },
      required: ['query'],
    },
  },
  {
    name: 'drive_read_file',
    description: 'Read content of a Google Doc or text file by file ID.',
    inputSchema: {
      type: 'object',
      properties: { file_id: { type: 'string', description: 'Drive file ID' } },
      required: ['file_id'],
    },
  },
  {
    name: 'drive_upload_text',
    description: 'Create a new Google Doc with text content.',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Document title' },
        content: { type: 'string', description: 'Document body' },
        folder_id: { type: 'string', description: 'Parent folder ID (optional)' },
      },
      required: ['title', 'content'],
    },
  },
  {
    name: 'drive_create_folder',
    description: 'Create a folder in Google Drive. Returns the folder ID.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Folder name' },
        parent_id: { type: 'string', description: 'Parent folder ID (optional, defaults to My Drive root)' },
      },
      required: ['name'],
    },
  },
  {
    name: 'drive_list_folder',
    description: 'List files and folders inside a Google Drive folder.',
    inputSchema: {
      type: 'object',
      properties: {
        folder_id: { type: 'string', description: 'Folder ID to list (optional, defaults to My Drive root)' },
        max_results: { type: 'number', description: 'Max items (default 30)' },
      },
      required: [],
    },
  },
  {
    name: 'drive_upload_file',
    description: 'Upload a local file to Google Drive (PDF, image, video, etc). Returns the file ID and link.',
    inputSchema: {
      type: 'object',
      properties: {
        local_path: { type: 'string', description: 'Absolute path to the local file to upload' },
        drive_name: { type: 'string', description: 'Name for the file in Drive (optional, defaults to local filename)' },
        folder_id: { type: 'string', description: 'Parent folder ID in Drive (optional)' },
      },
      required: ['local_path'],
    },
  },
  {
    name: 'sheets_read',
    description: 'Read data from a Google Sheet.',
    inputSchema: {
      type: 'object',
      properties: {
        spreadsheet_id: { type: 'string', description: 'Spreadsheet ID' },
        range: { type: 'string', description: 'Range (e.g. "Sheet1!A1:D10")' },
      },
      required: ['spreadsheet_id', 'range'],
    },
  },
  {
    name: 'sheets_write',
    description: 'Write data to a Google Sheet.',
    inputSchema: {
      type: 'object',
      properties: {
        spreadsheet_id: { type: 'string', description: 'Spreadsheet ID' },
        range: { type: 'string', description: 'Range (e.g. "Sheet1!A1")' },
        values: { type: 'string', description: 'JSON array of arrays' },
      },
      required: ['spreadsheet_id', 'range', 'values'],
    },
  },
  {
    name: 'tasks_list',
    description: 'List Google Tasks.',
    inputSchema: {
      type: 'object',
      properties: { max_results: { type: 'number', description: 'Max tasks (default 20)' } },
    },
  },
  {
    name: 'tasks_create',
    description: 'Create a Google Task.',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Task title' },
        notes: { type: 'string', description: 'Notes' },
        due: { type: 'string', description: 'Due date ISO 8601' },
      },
      required: ['title'],
    },
  },
];

// --- Tool execution ---
async function executeTool(name: string, args: Record<string, unknown>): Promise<string> {
  const userId = IMPERSONATE_USER || 'me';

  switch (name) {
    case 'gmail_list_messages': {
      const q = (args.query as string) || '';
      const max = (args.max_results as number) || 10;
      const data = await gapi(
        `https://gmail.googleapis.com/gmail/v1/users/${userId}/messages?q=${encodeURIComponent(q)}&maxResults=${max}`
      ) as { messages?: { id: string; threadId: string }[] };

      if (!data.messages?.length) return 'No messages found.';

      // Fetch snippets for each
      const results = [];
      for (const msg of data.messages.slice(0, max)) {
        const detail = await gapi(
          `https://gmail.googleapis.com/gmail/v1/users/${userId}/messages/${msg.id}?format=metadata&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=Date`
        ) as { id: string; snippet: string; payload?: { headers?: { name: string; value: string }[] } };

        const headers = detail.payload?.headers || [];
        const subject = headers.find(h => h.name === 'Subject')?.value || '(no subject)';
        const from = headers.find(h => h.name === 'From')?.value || '';
        const date = headers.find(h => h.name === 'Date')?.value || '';
        results.push(`ID: ${msg.id}\nFrom: ${from}\nDate: ${date}\nSubject: ${subject}\nSnippet: ${detail.snippet}\n`);
      }
      return results.join('\n---\n');
    }

    case 'gmail_read_message': {
      const data = await gapi(
        `https://gmail.googleapis.com/gmail/v1/users/${userId}/messages/${args.message_id}?format=full`
      ) as { payload?: { headers?: { name: string; value: string }[]; parts?: { mimeType: string; body?: { data?: string } }[]; body?: { data?: string } } };

      const headers = data.payload?.headers || [];
      const subject = headers.find(h => h.name === 'Subject')?.value || '';
      const from = headers.find(h => h.name === 'From')?.value || '';
      const date = headers.find(h => h.name === 'Date')?.value || '';

      // Extract body
      let body = '';
      const parts = data.payload?.parts;
      if (parts) {
        const textPart = parts.find(p => p.mimeType === 'text/plain');
        if (textPart?.body?.data) {
          body = Buffer.from(textPart.body.data, 'base64url').toString('utf-8');
        }
      } else if (data.payload?.body?.data) {
        body = Buffer.from(data.payload.body.data, 'base64url').toString('utf-8');
      }

      return `From: ${from}\nDate: ${date}\nSubject: ${subject}\n\n${body}`;
    }

    case 'gmail_send': {
      const headers = [
        `To: ${args.to}`,
        args.cc ? `Cc: ${args.cc}` : '',
        `Subject: ${args.subject}`,
        'Content-Type: text/plain; charset=utf-8',
        '',
        args.body,
      ].filter(Boolean).join('\r\n');
      const raw = Buffer.from(headers).toString('base64url');

      const result = await gapi(`https://gmail.googleapis.com/gmail/v1/users/${userId}/messages/send`, {
        method: 'POST',
        body: JSON.stringify({ raw }),
      }) as { id: string };

      return `Email sent. Message ID: ${result.id}`;
    }

    case 'calendar_list_events': {
      const calId = (args.calendar_id as string) || 'primary';
      const days = (args.days_ahead as number) || 7;
      const max = (args.max_results as number) || 20;
      const now = new Date().toISOString();
      const future = new Date(Date.now() + days * 86400000).toISOString();

      const data = await gapi(
        `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calId)}/events?timeMin=${now}&timeMax=${future}&maxResults=${max}&singleEvents=true&orderBy=startTime`
      ) as { items?: { summary: string; start: { dateTime?: string; date?: string }; end: { dateTime?: string; date?: string }; location?: string }[] };

      if (!data.items?.length) return 'No upcoming events.';

      return data.items.map(e => {
        const start = e.start.dateTime || e.start.date || '';
        const end = e.end.dateTime || e.end.date || '';
        return `${e.summary}\n  Start: ${start}\n  End: ${end}${e.location ? `\n  Location: ${e.location}` : ''}`;
      }).join('\n\n');
    }

    case 'calendar_create_event': {
      const event: Record<string, unknown> = {
        summary: args.summary,
        start: { dateTime: args.start },
        end: { dateTime: args.end },
      };
      if (args.description) event.description = args.description;
      if (args.location) event.location = args.location;
      if (args.attendees) {
        event.attendees = (args.attendees as string).split(',').map(e => ({ email: e.trim() }));
      }

      const result = await gapi('https://www.googleapis.com/calendar/v3/calendars/primary/events', {
        method: 'POST',
        body: JSON.stringify(event),
      }) as { id: string; htmlLink: string };

      return `Event created. ID: ${result.id}\nLink: ${result.htmlLink}`;
    }

    case 'drive_search': {
      const q = args.query as string;
      const max = (args.max_results as number) || 20;
      const driveQ = `name contains '${q.replace(/'/g, "\\'")}'`;

      const data = await gapi(
        `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(driveQ)}&pageSize=${max}&includeItemsFromAllDrives=true&supportsAllDrives=true&fields=files(id,name,mimeType,modifiedTime,size,webViewLink,driveId,parents)`
      ) as { files?: { id: string; name: string; mimeType: string; modifiedTime: string; webViewLink?: string }[] };

      if (!data.files?.length) return 'No files found.';

      return data.files.map(f =>
        `${f.name}\n  ID: ${f.id}\n  Type: ${f.mimeType}\n  Modified: ${f.modifiedTime}${f.webViewLink ? `\n  Link: ${f.webViewLink}` : ''}`
      ).join('\n\n');
    }

    case 'drive_read_file': {
      // Try as Google Doc first (export as text)
      try {
        const text = await gapi(
          `https://docs.googleapis.com/v1/documents/${args.file_id}`
        ) as { title: string; body?: { content?: unknown[] } };
        return JSON.stringify(text, null, 2).substring(0, 10000);
      } catch {
        // Try as plain download
        const text = await gapi(
          `https://www.googleapis.com/drive/v3/files/${args.file_id}?alt=media`
        );
        return typeof text === 'string' ? text.substring(0, 10000) : JSON.stringify(text).substring(0, 10000);
      }
    }

    case 'drive_upload_text': {
      // Create Google Doc
      const metadata: Record<string, unknown> = {
        name: args.title,
        mimeType: 'application/vnd.google-apps.document',
      };
      if (args.folder_id) metadata.parents = [args.folder_id];

      const doc = await gapi('https://docs.googleapis.com/v1/documents', {
        method: 'POST',
        body: JSON.stringify({ title: args.title }),
      }) as { documentId: string };

      // Insert content
      if (args.content) {
        await gapi(`https://docs.googleapis.com/v1/documents/${doc.documentId}:batchUpdate`, {
          method: 'POST',
          body: JSON.stringify({
            requests: [{ insertText: { location: { index: 1 }, text: args.content as string } }],
          }),
        });
      }

      return `Google Doc created. ID: ${doc.documentId}\nLink: https://docs.google.com/document/d/${doc.documentId}`;
    }

    case 'drive_create_folder': {
      const metadata: Record<string, unknown> = {
        name: args.name,
        mimeType: 'application/vnd.google-apps.folder',
      };
      if (args.parent_id) metadata.parents = [args.parent_id];

      const result = await gapi('https://www.googleapis.com/drive/v3/files', {
        method: 'POST',
        body: JSON.stringify(metadata),
      }) as { id: string; name: string };

      return `Folder created: "${result.name}"\nFolder ID: ${result.id}\nLink: https://drive.google.com/drive/folders/${result.id}`;
    }

    case 'drive_list_folder': {
      const folderId = (args.folder_id as string) || 'root';
      const max = (args.max_results as number) || 30;
      const q = `'${folderId}' in parents and trashed = false`;

      const data = await gapi(
        `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&pageSize=${max}&fields=files(id,name,mimeType,modifiedTime,size,webViewLink)`
      ) as { files?: { id: string; name: string; mimeType: string; modifiedTime: string; size?: string; webViewLink?: string }[] };

      if (!data.files?.length) return 'Folder is empty.';

      return data.files.map(f => {
        const isFolder = f.mimeType === 'application/vnd.google-apps.folder';
        const typeLabel = isFolder ? '[Folder]' : '[File]';
        const size = f.size ? ` (${Math.round(parseInt(f.size) / 1024)}KB)` : '';
        return `${typeLabel} ${f.name}${size}\n  ID: ${f.id}\n  Modified: ${f.modifiedTime}${f.webViewLink ? `\n  Link: ${f.webViewLink}` : ''}`;
      }).join('\n\n');
    }

    case 'drive_upload_file': {
      const localPath = args.local_path as string;
      if (!fs.existsSync(localPath)) throw new Error(`File not found: ${localPath}`);
      const fileBuffer = fs.readFileSync(localPath);
      const fileName = (args.drive_name as string) || path.basename(localPath);

      const ext = path.extname(localPath).toLowerCase();
      const mimeTypes: Record<string, string> = {
        '.pdf': 'application/pdf',
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.gif': 'image/gif',
        '.mp4': 'video/mp4',
        '.mp3': 'audio/mpeg',
        '.wav': 'audio/wav',
        '.txt': 'text/plain',
        '.json': 'application/json',
        '.csv': 'text/csv',
        '.zip': 'application/zip',
        '.webm': 'video/webm',
        '.mov': 'video/quicktime',
        '.mkv': 'video/x-matroska',
      };
      const mimeType = mimeTypes[ext] || 'application/octet-stream';

      const fileMeta: Record<string, unknown> = { name: fileName };
      if (args.folder_id) fileMeta.parents = [args.folder_id];

      const boundary = 'RevaquoUpload' + Date.now();
      const metaStr = JSON.stringify(fileMeta);

      const headerPart = Buffer.from(
        `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metaStr}\r\n--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`
      );
      const footerPart = Buffer.from(`\r\n--${boundary}--`);
      const body = Buffer.concat([headerPart, fileBuffer, footerPart]);

      const token = await getAccessToken();
      const uploadRes = await fetch(
        'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink',
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': `multipart/related; boundary=${boundary}`,
            'Content-Length': body.length.toString(),
          },
          body,
        }
      );

      const uploadText = await uploadRes.text();
      if (!uploadRes.ok) throw new Error(`Upload failed (${uploadRes.status}): ${uploadText.substring(0, 500)}`);

      const uploadResult = JSON.parse(uploadText) as { id: string; name: string; webViewLink?: string };
      return `File uploaded: "${uploadResult.name}"\nFile ID: ${uploadResult.id}${uploadResult.webViewLink ? `\nLink: ${uploadResult.webViewLink}` : ''}`;
    }

    case 'sheets_read': {
      const data = await gapi(
        `https://sheets.googleapis.com/v4/spreadsheets/${args.spreadsheet_id}/values/${encodeURIComponent(args.range as string)}`
      ) as { values?: string[][] };

      if (!data.values?.length) return 'No data found.';
      return data.values.map(row => row.join('\t')).join('\n');
    }

    case 'sheets_write': {
      const values = JSON.parse(args.values as string);
      await gapi(
        `https://sheets.googleapis.com/v4/spreadsheets/${args.spreadsheet_id}/values/${encodeURIComponent(args.range as string)}?valueInputOption=USER_ENTERED`,
        {
          method: 'PUT',
          body: JSON.stringify({ values }),
        }
      );
      return 'Data written successfully.';
    }

    case 'tasks_list': {
      const max = (args.max_results as number) || 20;
      const lists = await gapi('https://tasks.googleapis.com/tasks/v1/users/@me/lists?maxResults=1') as { items?: { id: string }[] };
      const listId = lists.items?.[0]?.id || '@default';

      const data = await gapi(
        `https://tasks.googleapis.com/tasks/v1/lists/${listId}/tasks?maxResults=${max}`
      ) as { items?: { title: string; notes?: string; due?: string; status: string }[] };

      if (!data.items?.length) return 'No tasks found.';
      return data.items.map(t =>
        `${t.status === 'completed' ? '✅' : '⬜'} ${t.title}${t.due ? ` (due: ${t.due})` : ''}${t.notes ? `\n  ${t.notes}` : ''}`
      ).join('\n');
    }

    case 'tasks_create': {
      const lists = await gapi('https://tasks.googleapis.com/tasks/v1/users/@me/lists?maxResults=1') as { items?: { id: string }[] };
      const listId = lists.items?.[0]?.id || '@default';

      const task: Record<string, string> = { title: args.title as string };
      if (args.notes) task.notes = args.notes as string;
      if (args.due) task.due = args.due as string;

      const result = await gapi(`https://tasks.googleapis.com/tasks/v1/lists/${listId}/tasks`, {
        method: 'POST',
        body: JSON.stringify(task),
      }) as { id: string };

      return `Task created. ID: ${result.id}`;
    }

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

// --- MCP message handler ---
function handleMessage(msg: Record<string, unknown>): void {
  const method = msg.method as string;
  const id = msg.id;

  if (method === 'initialize') {
    send({
      jsonrpc: '2.0',
      id,
      result: {
        protocolVersion: '2024-11-05',
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'gws-mcp', version: '2.0.0' },
      },
    });
    return;
  }

  if (method === 'notifications/initialized') return;

  if (method === 'tools/list') {
    send({
      jsonrpc: '2.0',
      id,
      result: { tools: TOOLS },
    });
    return;
  }

  if (method === 'tools/call') {
    const params = msg.params as { name: string; arguments?: Record<string, unknown> };
    executeTool(params.name, params.arguments || {})
      .then(result => {
        send({
          jsonrpc: '2.0',
          id,
          result: { content: [{ type: 'text', text: result }] },
        });
      })
      .catch(err => {
        send({
          jsonrpc: '2.0',
          id,
          result: {
            content: [{ type: 'text', text: `Error: ${(err as Error).message}` }],
            isError: true,
          },
        });
      });
    return;
  }

  send({ jsonrpc: '2.0', id, error: { code: -32601, message: `Unknown method: ${method}` } });
}

// --- Init ---
loadCredentials();
const authMode =
  creds.type === 'service_account' || creds.private_key
    ? `service-account ${creds.client_email}${IMPERSONATE_USER ? ` impersonating ${IMPERSONATE_USER}` : ''}`
    : 'oauth authorized_user';
process.stderr.write(`gws-mcp: Google Workspace MCP server started (${authMode})\n`);
