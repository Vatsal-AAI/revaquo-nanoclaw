/**
 * NanoClaw Agent Runner
 * Runs inside a container, receives config via stdin, outputs result to stdout
 *
 * Input protocol:
 *   Stdin: Full ContainerInput JSON (read until EOF, like before)
 *   IPC:   Follow-up messages written as JSON files to /workspace/ipc/input/
 *          Files: {type:"message", text:"..."}.json — polled and consumed
 *          Sentinel: /workspace/ipc/input/_close — signals session end
 *
 * Stdout protocol:
 *   Each result is wrapped in OUTPUT_START_MARKER / OUTPUT_END_MARKER pairs.
 *   Multiple results may be emitted (one per agent teams result).
 *   Final marker after loop ends signals completion.
 */

import fs from 'fs';
import path from 'path';
import { query, HookCallback, PreCompactHookInput } from '@anthropic-ai/claude-agent-sdk';
import { fileURLToPath } from 'url';

interface ContainerInput {
  prompt: string;
  sessionId?: string;
  groupFolder: string;
  chatJid: string;
  isMain: boolean;
  isScheduledTask?: boolean;
  assistantName?: string;
  imageAttachments?: Array<{ relativePath: string; mediaType: string }>;

}

interface ImageContentBlock {
  type: 'image';
  source: { type: 'base64'; media_type: string; data: string };
}
interface TextContentBlock {
  type: 'text';
  text: string;
}
type ContentBlock = ImageContentBlock | TextContentBlock;

interface ContainerOutput {
  status: 'success' | 'error';
  result: string | null;
  newSessionId?: string;
  error?: string;
}

interface SessionEntry {
  sessionId: string;
  fullPath: string;
  summary: string;
  firstPrompt: string;
}

interface SessionsIndex {
  entries: SessionEntry[];
}

interface SDKUserMessage {
  type: 'user';
  message: { role: 'user'; content: string | ContentBlock[] };
  parent_tool_use_id: null;
  session_id: string;
}

const IPC_INPUT_DIR = '/workspace/ipc/input';
const IPC_INPUT_CLOSE_SENTINEL = path.join(IPC_INPUT_DIR, '_close');
const IPC_POLL_MS = 500;

/**
 * Push-based async iterable for streaming user messages to the SDK.
 * Keeps the iterable alive until end() is called, preventing isSingleUserTurn.
 */
class MessageStream {
  private queue: SDKUserMessage[] = [];
  private waiting: (() => void) | null = null;
  private done = false;

  push(text: string): void {
    this.queue.push({
      type: 'user',
      message: { role: 'user', content: text },
      parent_tool_use_id: null,
      session_id: '',
    });
    this.waiting?.();
  }

  pushMultimodal(content: ContentBlock[]): void {
    this.queue.push({
      type: 'user',
      message: { role: 'user', content },
      parent_tool_use_id: null,
      session_id: '',
    });
    this.waiting?.();
  }

  end(): void {
    this.done = true;
    this.waiting?.();
  }

  async *[Symbol.asyncIterator](): AsyncGenerator<SDKUserMessage> {
    while (true) {
      while (this.queue.length > 0) {
        yield this.queue.shift()!;
      }
      if (this.done) return;
      await new Promise<void>(r => { this.waiting = r; });
      this.waiting = null;
    }
  }
}

async function readStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', chunk => { data += chunk; });
    process.stdin.on('end', () => resolve(data));
    process.stdin.on('error', reject);
  });
}

const OUTPUT_START_MARKER = '---NANOCLAW_OUTPUT_START---';
const OUTPUT_END_MARKER = '---NANOCLAW_OUTPUT_END---';

function writeOutput(output: ContainerOutput): void {
  console.log(OUTPUT_START_MARKER);
  console.log(JSON.stringify(output));
  console.log(OUTPUT_END_MARKER);
}

function log(message: string): void {
  console.error(`[agent-runner] ${message}`);
}

function getSessionSummary(sessionId: string, transcriptPath: string): string | null {
  const projectDir = path.dirname(transcriptPath);
  const indexPath = path.join(projectDir, 'sessions-index.json');

  if (!fs.existsSync(indexPath)) {
    log(`Sessions index not found at ${indexPath}`);
    return null;
  }

  try {
    const index: SessionsIndex = JSON.parse(fs.readFileSync(indexPath, 'utf-8'));
    const entry = index.entries.find(e => e.sessionId === sessionId);
    if (entry?.summary) {
      return entry.summary;
    }
  } catch (err) {
    log(`Failed to read sessions index: ${err instanceof Error ? err.message : String(err)}`);
  }

  return null;
}

/**
 * Archive the full transcript to conversations/ before compaction.
 */
function createPreCompactHook(assistantName?: string): HookCallback {
  return async (input, _toolUseId, _context) => {
    const preCompact = input as PreCompactHookInput;
    const transcriptPath = preCompact.transcript_path;
    const sessionId = preCompact.session_id;

    if (!transcriptPath || !fs.existsSync(transcriptPath)) {
      log('No transcript found for archiving');
      return {};
    }

    try {
      const content = fs.readFileSync(transcriptPath, 'utf-8');
      const messages = parseTranscript(content);

      if (messages.length === 0) {
        log('No messages to archive');
        return {};
      }

      const summary = getSessionSummary(sessionId, transcriptPath);
      const name = summary ? sanitizeFilename(summary) : generateFallbackName();

      const conversationsDir = '/workspace/group/conversations';
      fs.mkdirSync(conversationsDir, { recursive: true });

      const date = new Date().toISOString().split('T')[0];
      const filename = `${date}-${name}.md`;
      const filePath = path.join(conversationsDir, filename);

      const markdown = formatTranscriptMarkdown(messages, summary, assistantName);
      fs.writeFileSync(filePath, markdown);

      log(`Archived conversation to ${filePath}`);

      // Hermes pattern: flush session learnings to memory before compaction
      // Write a summary snapshot so the next session starts with context
      const memoryDir = '/workspace/group/memory';
      fs.mkdirSync(memoryDir, { recursive: true });
      const summaryPath = path.join(memoryDir, 'summary.md');
      const timestamp = new Date().toISOString();
      const sessionTag = sessionId?.slice(0, 8) || 'unknown';

      // Extract key facts from the conversation for the summary
      const keyMessages = messages
        .filter(m => m.role === 'assistant' && m.content.length > 50)
        .slice(-3) // Last 3 substantive assistant messages
        .map(m => m.content.slice(0, 200))
        .join('\n');

      const logEntry = `\n## Session ${sessionTag} — ${timestamp}\n${summary || 'No summary available'}\n\nKey context:\n${keyMessages}\n`;

      // Keep summary file under 5000 chars — trim oldest entries
      let existing = '';
      if (fs.existsSync(summaryPath)) {
        existing = fs.readFileSync(summaryPath, 'utf-8');
      }
      const combined = existing + logEntry;
      if (combined.length > 5000) {
        // Keep only the newest half
        const lines = combined.split('\n## ');
        const keep = lines.slice(Math.floor(lines.length / 2));
        fs.writeFileSync(summaryPath, '## ' + keep.join('\n## '));
      } else {
        fs.writeFileSync(summaryPath, combined);
      }
      log(`Memory summary updated at ${summaryPath}`);
    } catch (err) {
      log(`Failed to archive transcript: ${err instanceof Error ? err.message : String(err)}`);
    }

    return {};
  };
}

function sanitizeFilename(summary: string): string {
  return summary
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50);
}

function generateFallbackName(): string {
  const time = new Date();
  return `conversation-${time.getHours().toString().padStart(2, '0')}${time.getMinutes().toString().padStart(2, '0')}`;
}

interface ParsedMessage {
  role: 'user' | 'assistant';
  content: string;
}

function parseTranscript(content: string): ParsedMessage[] {
  const messages: ParsedMessage[] = [];

  for (const line of content.split('\n')) {
    if (!line.trim()) continue;
    try {
      const entry = JSON.parse(line);
      if (entry.type === 'user' && entry.message?.content) {
        const text = typeof entry.message.content === 'string'
          ? entry.message.content
          : entry.message.content.map((c: { text?: string }) => c.text || '').join('');
        if (text) messages.push({ role: 'user', content: text });
      } else if (entry.type === 'assistant' && entry.message?.content) {
        const textParts = entry.message.content
          .filter((c: { type: string }) => c.type === 'text')
          .map((c: { text: string }) => c.text);
        const text = textParts.join('');
        if (text) messages.push({ role: 'assistant', content: text });
      }
    } catch {
    }
  }

  return messages;
}

function formatTranscriptMarkdown(messages: ParsedMessage[], title?: string | null, assistantName?: string): string {
  const now = new Date();
  const formatDateTime = (d: Date) => d.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true
  });

  const lines: string[] = [];
  lines.push(`# ${title || 'Conversation'}`);
  lines.push('');
  lines.push(`Archived: ${formatDateTime(now)}`);
  lines.push('');
  lines.push('---');
  lines.push('');

  for (const msg of messages) {
    const sender = msg.role === 'user' ? 'User' : (assistantName || 'Assistant');
    const content = msg.content.length > 2000
      ? msg.content.slice(0, 2000) + '...'
      : msg.content;
    lines.push(`**${sender}**: ${content}`);
    lines.push('');
  }

  return lines.join('\n');
}

/**
 * Check for _close sentinel.
 */
function shouldClose(): boolean {
  if (fs.existsSync(IPC_INPUT_CLOSE_SENTINEL)) {
    try { fs.unlinkSync(IPC_INPUT_CLOSE_SENTINEL); } catch { /* ignore */ }
    return true;
  }
  return false;
}

/**
 * Drain all pending IPC input messages.
 * Returns messages found, or empty array.
 */
function drainIpcInput(): string[] {
  try {
    fs.mkdirSync(IPC_INPUT_DIR, { recursive: true });
    const files = fs.readdirSync(IPC_INPUT_DIR)
      .filter(f => f.endsWith('.json'))
      .sort();

    const messages: string[] = [];
    for (const file of files) {
      const filePath = path.join(IPC_INPUT_DIR, file);
      try {
        const raw = fs.readFileSync(filePath, 'utf-8');
        // Delete BEFORE parsing — even if parse fails, don't reprocess
        try { fs.unlinkSync(filePath); } catch { /* already gone, ok */ }
        const data = JSON.parse(raw);
        if (data.type === 'message' && data.text) {
          messages.push(data.text);
        }
      } catch (err) {
        // File vanished between readdir and readFile (OneDrive/race) — skip
        if (err instanceof Error && err.message.includes('ENOENT')) continue;
        log(`Failed to process input file ${file}: ${err instanceof Error ? err.message : String(err)}`);
        try { fs.unlinkSync(filePath); } catch { /* ignore */ }
      }
    }
    return messages;
  } catch (err) {
    log(`IPC drain error: ${err instanceof Error ? err.message : String(err)}`);
    return [];
  }
}

/**
 * Wait for a new IPC message or _close sentinel.
 * Returns the messages as a single string, or null if _close.
 */
function waitForIpcMessage(): Promise<string | null> {
  return new Promise((resolve) => {
    const poll = () => {
      if (shouldClose()) {
        resolve(null);
        return;
      }
      const messages = drainIpcInput();
      if (messages.length > 0) {
        resolve(messages.join('\n'));
        return;
      }
      setTimeout(poll, IPC_POLL_MS);
    };
    poll();
  });
}

/**
 * Run a single query and stream results via writeOutput.
 * Uses MessageStream (AsyncIterable) to keep isSingleUserTurn=false,
 * allowing agent teams subagents to run to completion.
 * Also pipes IPC messages into the stream during the query.
 */
async function runQuery(
  prompt: string,
  sessionId: string | undefined,
  mcpServerPath: string,
  containerInput: ContainerInput,
  sdkEnv: Record<string, string | undefined>,
  resumeAt?: string,
): Promise<{ newSessionId?: string; lastAssistantUuid?: string; closedDuringQuery: boolean }> {
  // Compute sibling MCP paths from the nanoclaw MCP path
  const mcpDir = path.dirname(mcpServerPath);
  const falMcpPath = path.join(mcpDir, 'fal-mcp-stdio.js');
  const sarvamMcpPath = path.join(mcpDir, 'sarvam-mcp-stdio.js');
  const yourmemoryMcpPath = path.join(mcpDir, 'yourmemory-mcp.js');
  const gwsMcpPath = path.join(mcpDir, 'gws-mcp-stdio.js');

  // Per-group Google Workspace impersonation (e.g. PULSE → support@myrawellness.in).
  // If /workspace/group/gws.json sets impersonateUser, this agent talks to Google
  // AS that mailbox via the service-account GWS MCP, and the shared-identity
  // gmail/gdrive MCPs are turned off for this group to avoid identity confusion.
  // Groups without gws.json are unaffected and keep the shared gmail/gdrive MCPs.
  let gwsConfig: {
    impersonateUser?: string;
    credentialsFile?: string;
    scopes?: string;
  } | null = null;
  try {
    const gwsCfgPath = '/workspace/group/gws.json';
    if (fs.existsSync(gwsCfgPath)) {
      gwsConfig = JSON.parse(fs.readFileSync(gwsCfgPath, 'utf-8'));
    }
  } catch (err) {
    log(`Failed to read gws.json: ${err instanceof Error ? err.message : String(err)}`);
  }
  const gwsEnabled = !!gwsConfig?.impersonateUser;

  const stream = new MessageStream();
  stream.push(prompt);

  // Load image attachments and send as multimodal content blocks
  if (containerInput.imageAttachments?.length) {
    const blocks: ContentBlock[] = [];
    for (const img of containerInput.imageAttachments) {
      const imgPath = path.join('/workspace/group', img.relativePath);
      try {
        const data = fs.readFileSync(imgPath).toString('base64');
        blocks.push({ type: 'image', source: { type: 'base64', media_type: img.mediaType, data } });
      } catch (err) {
        log(`Failed to load image: ${imgPath}`);
      }
    }
    if (blocks.length > 0) {
      stream.pushMultimodal(blocks);
    }
  }

  // Poll IPC for follow-up messages and _close sentinel during the query
  let ipcPolling = true;
  let closedDuringQuery = false;
  const pollIpcDuringQuery = () => {
    if (!ipcPolling) return;
    if (shouldClose()) {
      log('Close sentinel detected during query, ending stream');
      closedDuringQuery = true;
      stream.end();
      ipcPolling = false;
      return;
    }
    const messages = drainIpcInput();
    for (const text of messages) {
      log(`Piping IPC message into active query (${text.length} chars)`);
      stream.push(text);
    }
    setTimeout(pollIpcDuringQuery, IPC_POLL_MS);
  };
  setTimeout(pollIpcDuringQuery, IPC_POLL_MS);

  let newSessionId: string | undefined;
  let lastAssistantUuid: string | undefined;
  let messageCount = 0;
  let resultCount = 0;

  // Load global CLAUDE.md as additional system context (shared across all groups)
  const globalClaudeMdPath = '/workspace/global/CLAUDE.md';
  let globalClaudeMd: string | undefined;
  if (!containerInput.isMain && fs.existsSync(globalClaudeMdPath)) {
    globalClaudeMd = fs.readFileSync(globalClaudeMdPath, 'utf-8');
  }

  // Hermes pattern: auto-inject memory snapshot into system prompt
  // Agents get baseline context without needing to call recall_memory
  const memoryFiles = [
    '/workspace/group/memory/STATE.md',
    '/workspace/group/memory/MEMORY.md',
    '/workspace/group/memory/summary.md',
  ];
  let memorySnapshot: string | undefined;
  for (const memPath of memoryFiles) {
    if (fs.existsSync(memPath)) {
      const content = fs.readFileSync(memPath, 'utf-8').trim();
      if (content.length > 0 && content.length < 10000) { // Cap at 10k chars
        memorySnapshot = `\n\n---\n## YOUR MEMORY (auto-injected from ${path.basename(memPath)})\n${content}\n---\n`;
        break;
      }
    }
  }

  // Discover additional directories mounted at /workspace/extra/*
  // These are passed to the SDK so their CLAUDE.md files are loaded automatically
  const extraDirs: string[] = [];
  const extraBase = '/workspace/extra';
  if (fs.existsSync(extraBase)) {
    for (const entry of fs.readdirSync(extraBase)) {
      const fullPath = path.join(extraBase, entry);
      if (fs.statSync(fullPath).isDirectory()) {
        extraDirs.push(fullPath);
      }
    }
  }
  if (extraDirs.length > 0) {
    log(`Additional directories: ${extraDirs.join(', ')}`);
  }

  for await (const message of query({
    prompt: stream,
    options: {
      cwd: '/workspace/group',
      additionalDirectories: extraDirs.length > 0 ? extraDirs : undefined,
      resume: sessionId,
      resumeSessionAt: resumeAt,
      systemPrompt: (globalClaudeMd || memorySnapshot)
        ? {
            type: 'preset' as const,
            preset: 'claude_code' as const,
            append: [globalClaudeMd, memorySnapshot].filter(Boolean).join('\n\n'),
          }
        : undefined,
      allowedTools: [
        'Bash',
        'Read', 'Write', 'Edit', 'Glob', 'Grep',
        'WebSearch', 'WebFetch',
        'Task', 'TaskOutput', 'TaskStop',
        'TeamCreate', 'TeamDelete', 'SendMessage',
        'TodoWrite', 'ToolSearch', 'Skill',
        'NotebookEdit',
        'mcp__nanoclaw__*',
        'mcp__gmail__*',
        'mcp__gdrive__*',
        'mcp__gws__*',
        'mcp__yourmemory__*',
        'mcp__fal__*',
        'mcp__sarvam__*',
      ],
      env: sdkEnv,
      permissionMode: 'bypassPermissions',
      allowDangerouslySkipPermissions: true,
      settingSources: ['project', 'user'],
      mcpServers: {
        nanoclaw: {
          command: 'node',
          args: [mcpServerPath],
          env: {
            NANOCLAW_CHAT_JID: containerInput.chatJid,
            NANOCLAW_GROUP_FOLDER: containerInput.groupFolder,
            NANOCLAW_IS_MAIN: containerInput.isMain ? '1' : '0',
          },
        },
        yourmemory: {
          command: 'node',
          args: [yourmemoryMcpPath],
          env: {
            YOURMEMORY_URL: `http://${process.env.CONTAINER_HOST_GATEWAY || 'host.docker.internal'}:8000`,
            YOURMEMORY_USER_ID: containerInput.groupFolder,
          },
        },
        ...(process.env.FAL_KEY ? {
          fal: {
            command: 'node',
            args: [falMcpPath],
            env: {
              FAL_KEY: process.env.FAL_KEY,
            },
          },
        } : {}),
        ...(process.env.SARVAM_API_KEY ? {
          sarvam: {
            command: 'node',
            args: [sarvamMcpPath],
            env: {
              SARVAM_API_KEY: process.env.SARVAM_API_KEY,
            },
          },
        } : {}),
        // Google Workspace: a group with gws.json (impersonateUser) talks to Google
        // as that mailbox via the service-account GWS MCP. Every other group keeps
        // the shared-identity gmail + gdrive MCPs exactly as before.
        ...(gwsEnabled
          ? {
              gws: {
                command: 'node',
                args: [gwsMcpPath],
                env: {
                  GWS_CREDENTIALS_PATH: `/workspace/extra/gws-config/${gwsConfig!.credentialsFile || 'credentials.json'}`,
                  GWS_IMPERSONATE_USER: gwsConfig!.impersonateUser!,
                  ...(gwsConfig!.scopes ? { GWS_SCOPES: gwsConfig!.scopes } : {}),
                },
              },
            }
          : {
              gmail: {
                command: 'npx',
                args: ['-y', '@gongrzhe/server-gmail-autoauth-mcp'],
              },
              gdrive: {
                command: 'npx',
                args: ['-y', '@modelcontextprotocol/server-gdrive'],
                env: {
                  GDRIVE_OAUTH_PATH: '/home/node/.gmail-mcp/gcp-oauth.keys.json',
                  GDRIVE_CREDENTIALS_PATH: '/home/node/.gmail-mcp/credentials.json',
                },
              },
            }),
      },
      hooks: {
        PreCompact: [{ hooks: [createPreCompactHook(containerInput.assistantName)] }],
      },
    }
  })) {
    messageCount++;
    const msgType = message.type === 'system' ? `system/${(message as { subtype?: string }).subtype}` : message.type;
    log(`[msg #${messageCount}] type=${msgType}`);

    if (message.type === 'assistant' && 'uuid' in message) {
      lastAssistantUuid = (message as { uuid: string }).uuid;
    }

    if (message.type === 'system' && message.subtype === 'init') {
      newSessionId = message.session_id;
      log(`Session initialized: ${newSessionId}`);
    }

    // Hermes pattern: context length guard — warn when approaching limits
    const msgAny = message as Record<string, unknown>;
    if (msgAny.usage && typeof msgAny.usage === 'object') {
      const usage = msgAny.usage as { input_tokens?: number };
      if (usage.input_tokens && usage.input_tokens > 150000) {
        log(`⚠️ Context approaching limit: ${usage.input_tokens} tokens`);
      }
    }

    if (message.type === 'system' && (message as { subtype?: string }).subtype === 'task_notification') {
      const tn = message as { task_id: string; status: string; summary: string };
      log(`Task notification: task=${tn.task_id} status=${tn.status} summary=${tn.summary}`);
    }

    if (message.type === 'result') {
      resultCount++;
      const textResult = 'result' in message ? (message as { result?: string }).result : null;
      log(`Result #${resultCount}: subtype=${message.subtype}${textResult ? ` text=${textResult.slice(0, 200)}` : ''}`);
      writeOutput({
        status: 'success',
        result: textResult || null,
        newSessionId
      });
    }
  }

  ipcPolling = false;
  log(`Query done. Messages: ${messageCount}, results: ${resultCount}, lastAssistantUuid: ${lastAssistantUuid || 'none'}, closedDuringQuery: ${closedDuringQuery}`);
  return { newSessionId, lastAssistantUuid, closedDuringQuery };
}

async function main(): Promise<void> {
  let containerInput: ContainerInput;

  try {
    const stdinData = await readStdin();
    containerInput = JSON.parse(stdinData);
    try { fs.unlinkSync('/tmp/input.json'); } catch { /* may not exist */ }
    log(`Received input for group: ${containerInput.groupFolder}`);
  } catch (err) {
    writeOutput({
      status: 'error',
      result: null,
      error: `Failed to parse input: ${err instanceof Error ? err.message : String(err)}`
    });
    process.exit(1);
  }

  // Credentials are injected by the host's credential proxy via ANTHROPIC_BASE_URL.
  // No real secrets exist in the container environment.
  const sdkEnv: Record<string, string | undefined> = { ...process.env };

  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const mcpServerPath = path.join(__dirname, 'ipc-mcp-stdio.js');

  let sessionId = containerInput.sessionId;
  fs.mkdirSync(IPC_INPUT_DIR, { recursive: true });

  // Clean up stale _close sentinel from previous container runs
  try { fs.unlinkSync(IPC_INPUT_CLOSE_SENTINEL); } catch { /* ignore */ }

  // Build initial prompt (drain any pending IPC messages too)
  let prompt = containerInput.prompt;
  if (containerInput.isScheduledTask) {
    prompt = `[SCHEDULED TASK - The following message was sent automatically and is not coming directly from the user or group.]\n\n${prompt}`;
  }
  const pending = drainIpcInput();
  if (pending.length > 0) {
    log(`Draining ${pending.length} pending IPC messages into initial prompt`);
    prompt += '\n' + pending.join('\n');
  }

  // Query loop: run query → wait for IPC message → run new query → repeat
  let resumeAt: string | undefined;
  let turnCount = 0;
  const MAX_TURNS_PER_SESSION = parseInt(process.env.MAX_TURNS_PER_SESSION || '20', 10);
  try {
    while (true) {
      log(`Starting query (session: ${sessionId || 'new'}, resumeAt: ${resumeAt || 'latest'}, turn: ${turnCount + 1}/${MAX_TURNS_PER_SESSION})...`);

      const queryResult = await runQuery(prompt, sessionId, mcpServerPath, containerInput, sdkEnv, resumeAt);
      if (queryResult.newSessionId) {
        sessionId = queryResult.newSessionId;
      }
      if (queryResult.lastAssistantUuid) {
        resumeAt = queryResult.lastAssistantUuid;
      }
      turnCount++;

      // If _close was consumed during the query, exit immediately.
      // Don't emit a session-update marker (it would reset the host's
      // idle timer and cause a 30-min delay before the next _close).
      if (queryResult.closedDuringQuery) {
        log('Close sentinel consumed during query, exiting');
        break;
      }

      // Session rotation: reset after MAX_TURNS_PER_SESSION turns to cap token costs.
      // memory/summary.md (written by the PreCompact hook or periodic saves) provides
      // continuity — the new session picks it up via the memorySnapshot injection.
      if (turnCount >= MAX_TURNS_PER_SESSION) {
        log(`Session rotation at turn ${turnCount} — starting fresh session, memory snapshot will carry context`);
        sessionId = undefined;
        resumeAt = undefined;
        turnCount = 0;
      }

      // Emit session update so host can track it
      writeOutput({ status: 'success', result: null, newSessionId: sessionId });

      log('Query ended, waiting for next IPC message...');

      // Wait for the next message or _close sentinel
      const nextMessage = await waitForIpcMessage();
      if (nextMessage === null) {
        log('Close sentinel received, exiting');
        break;
      }

      log(`Got new message (${nextMessage.length} chars), starting new query`);
      prompt = nextMessage;
    }
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    log(`Agent error: ${errorMessage}`);
    writeOutput({
      status: 'error',
      result: null,
      newSessionId: sessionId,
      error: errorMessage
    });
    process.exit(1);
  }
}

main();
