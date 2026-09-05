import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApplication } from '../src/runtime/application.js';
import { runtimeConfig } from '../src/runtime/config.js';
// No test suite can incur provider spend or deliver external notifications.
for (const name of [
  'OPENAI_API_KEY',
  'ANTHROPIC_API_KEY',
  'GEMINI_API_KEY',
  'PERPLEXITY_API_KEY',
  'RESEND_API_KEY',
])
  delete process.env[name];
const directory = mkdtempSync(join(tmpdir(), 'miscited-e2e-'));
const application = await createApplication(
  runtimeConfig({
    ...process.env,
    PORT: '4399',
    MISCITED_DB: join(directory, 'test.sqlite'),
    MISCITED_NO_SCHEDULER: '1',
    MISCITED_DEMO_FETCH: '1',
  }),
);
await application.app.listen({ port: 4399, host: '127.0.0.1' });
let closing = false;
async function close() {
  if (closing) return;
  closing = true;
  await application.close();
  rmSync(directory, { recursive: true, force: true });
}
process.once('SIGTERM', () => void close());
process.once('SIGINT', () => void close());
