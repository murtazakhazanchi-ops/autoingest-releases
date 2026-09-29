/**
 * sharedClient.ts — the single AutoIngestClient instance every action uses.
 *
 * Logging conventions (see docs/mxLogitechPlugin.md "Logging"): concise,
 * one line per event, never the token, never a full descriptor, never a
 * continuous state snapshot dump.
 */

import { AutoIngestClient, type LogLevel } from './autoIngestClient.js';

function logToConsole(level: LogLevel, message: string): void {
  const line = `[autoingest-mx] ${message}`;
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line); // 'info' and 'debug' both go to stdout; the SDK/host captures plugin stdout as its log stream
}

export const autoIngestClient = new AutoIngestClient(logToConsole);
