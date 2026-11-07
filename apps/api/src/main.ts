import 'dotenv/config';
import { createApp } from './app';
import { AvatarJobs } from './avatar-jobs';
import { OfflineMaintenance } from './offline/offline-maintenance';
import { AnalysisJobs } from './analytics/jobs.service';
async function main() {
  const app = await createApp();
  app.get(AvatarJobs).start();
  app.get(OfflineMaintenance).start();
  app.get(AnalysisJobs).start();
  const port = Number(process.env.API_PORT || 3018);
  const host = process.env.API_HOST || '127.0.0.1';
  await app.listen(port, host);
  console.log(`API Grupo 18: http://${host}:${port}`);
}
void main();
