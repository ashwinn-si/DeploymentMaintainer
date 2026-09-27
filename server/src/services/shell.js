import { spawn } from 'node:child_process';

const MAX_BUFFER_BYTES = 200 * 1024;
const FORCE_KILL_DELAY_MS = 5000;
const UNQUOTED_OPERATORS = new Set(['|', ';', '&', '>', '<', '`']);

function appendCapped(buffer, chunk) {
  const combined = buffer + chunk;
  return combined.length > MAX_BUFFER_BYTES ? combined.slice(combined.length - MAX_BUFFER_BYTES) : combined;
}

/**
 * Tokenizes a command string into an argv array, supporting whitespace
 * separation, single/double quotes and backslash escapes. Deliberately does
 * NOT support globbing, variable expansion, pipes, or other shell operators:
 * those are rejected outright so callers never accidentally hand a shell
 * metacharacter to something that runs with shell:false.
 */
export function tokenizeCommand(str) {
  if (typeof str !== 'string') {
    throw new TypeError('tokenizeCommand expects a string');
  }

  const tokens = [];
  let current = '';
  let hasCurrent = false;
  let inSingle = false;
  let inDouble = false;

  for (let i = 0; i < str.length; i += 1) {
    const c = str[i];

    if (inSingle) {
      if (c === "'") {
        inSingle = false;
      } else {
        current += c;
      }
      continue;
    }

    if (inDouble) {
      if (c === '\\' && i + 1 < str.length) {
        current += str[i + 1];
        i += 1;
      } else if (c === '"') {
        inDouble = false;
      } else {
        current += c;
      }
      continue;
    }

    if (c === "'") {
      inSingle = true;
      hasCurrent = true;
      continue;
    }

    if (c === '"') {
      inDouble = true;
      hasCurrent = true;
      continue;
    }

    if (c === '\\') {
      if (i + 1 < str.length) {
        current += str[i + 1];
        i += 1;
      } else {
        current += c;
      }
      hasCurrent = true;
      continue;
    }

    if (/\s/.test(c)) {
      if (hasCurrent) {
        tokens.push(current);
        current = '';
        hasCurrent = false;
      }
      continue;
    }

    if (c === '$' && str[i + 1] === '(') {
      throw new Error('shell operators are not supported; add separate custom steps instead');
    }

    if (UNQUOTED_OPERATORS.has(c)) {
      throw new Error('shell operators are not supported; add separate custom steps instead');
    }

    current += c;
    hasCurrent = true;
  }

  if (inSingle || inDouble) {
    throw new Error('unterminated quote in command string');
  }

  if (hasCurrent) {
    tokens.push(current);
  }

  return tokens;
}

/**
 * Runs a command with shell:false, streaming line-by-line output via onLine
 * and supporting abort (AbortSignal) / timeoutMs, both of which terminate
 * the whole process group (SIGTERM, then SIGKILL after 5s if still alive).
 */
export function run(cmd, argv = [], options = {}) {
  if (typeof cmd !== 'string' || cmd.length === 0) {
    return Promise.reject(new TypeError('cmd must be a non-empty string'));
  }
  if (!Array.isArray(argv) || argv.some((a) => typeof a !== 'string')) {
    return Promise.reject(new TypeError('argv must be an array of strings'));
  }

  const { cwd, env, onLine, signal, timeoutMs } = options;

  return new Promise((resolve, reject) => {
    let settled = false;
    let child;

    try {
      child = spawn(cmd, argv, {
        cwd,
        env: env ?? process.env,
        shell: false,
        detached: true,
      });
    } catch (err) {
      reject(err);
      return;
    }

    let stdoutBuf = '';
    let stderrBuf = '';
    const partials = { stdout: '', stderr: '' };
    let aborted = false;
    let timedOut = false;
    let killTimer = null;
    let timeoutTimer = null;

    function handleChunk(streamName, chunk) {
      const text = partials[streamName] + chunk.toString('utf8');
      const lines = text.split('\n');
      partials[streamName] = lines.pop();
      for (const rawLine of lines) {
        const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine;
        if (onLine) onLine({ stream: streamName, text: line });
      }
    }

    child.stdout.on('data', (chunk) => {
      stdoutBuf = appendCapped(stdoutBuf, chunk.toString('utf8'));
      handleChunk('stdout', chunk);
    });
    child.stderr.on('data', (chunk) => {
      stderrBuf = appendCapped(stderrBuf, chunk.toString('utf8'));
      handleChunk('stderr', chunk);
    });

    function killGroup(sig) {
      if (child.pid == null) return;
      try {
        process.kill(-child.pid, sig);
      } catch {
        try {
          child.kill(sig);
        } catch {
          // process may already be gone
        }
      }
    }

    function scheduleForceKill() {
      killTimer = setTimeout(() => killGroup('SIGKILL'), FORCE_KILL_DELAY_MS);
      if (killTimer.unref) killTimer.unref();
    }

    function onAbort() {
      aborted = true;
      killGroup('SIGTERM');
      scheduleForceKill();
    }

    if (timeoutMs) {
      timeoutTimer = setTimeout(() => {
        timedOut = true;
        killGroup('SIGTERM');
        scheduleForceKill();
      }, timeoutMs);
      if (timeoutTimer.unref) timeoutTimer.unref();
    }

    if (signal) {
      if (signal.aborted) {
        onAbort();
      } else {
        signal.addEventListener('abort', onAbort, { once: true });
      }
    }

    function cleanup() {
      if (killTimer) clearTimeout(killTimer);
      if (timeoutTimer) clearTimeout(timeoutTimer);
      if (signal) signal.removeEventListener('abort', onAbort);
    }

    child.on('error', (err) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(err);
    });

    child.on('close', (code, sig) => {
      if (settled) return;
      settled = true;

      if (partials.stdout.length > 0 && onLine) {
        onLine({ stream: 'stdout', text: partials.stdout });
      }
      if (partials.stderr.length > 0 && onLine) {
        onLine({ stream: 'stderr', text: partials.stderr });
      }

      cleanup();
      resolve({
        code,
        signal: sig,
        stdout: stdoutBuf,
        stderr: stderrBuf,
        aborted,
        timedOut,
      });
    });
  });
}
