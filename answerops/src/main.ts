import { runtimeConfig } from './runtime/config.js';
import { createApplication } from './runtime/application.js';

const config = runtimeConfig(process.env);
const application = await createApplication(config);
try {
  await application.app.listen({ port: config.port, host: '0.0.0.0' });
  console.log(`Miscited listening on http://localhost:${config.port}`);
  console.log(
    `scheduler ${config.scheduler ? 'on' : 'off'}, citation fetching ${config.fetchMode}, db ${config.dbPath}`,
  );
} catch (error) {
  await application.close();
  throw error;
}
const close = () => {
  void application.close().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
};
process.once('SIGINT', close);
process.once('SIGTERM', close);
