// @ts-nocheck
import { PostgresService } from './src/services/postgres.service';
import * as fs from 'fs';
import * as path from 'path';

const svc = new PostgresService({ host: '1', port: 5432, database: 'd', user: 'u', password: 'p', schema: 'public' });
let sqlQuery = '';
svc.pool.query = async (q: any) => {
  if (typeof q === 'string' && q.includes('CREATE OR REPLACE VIEW public.v_unified_analytics')) {
    sqlQuery = q;
  }
  return { rows: [] };
};
svc.dropAnalyticsViews = async () => {};
svc.createAnalyticsViews({ query: svc.pool.query }).then(() => {
  const sqlFile = path.join(__dirname, '../postgres/init/002_analytics_views.sql');
  const header = '-- Analytics views are recreated by backend/src/services/postgres.service.ts on\n-- every startup. This file mirrors the current bootstrap shape of\n-- public.v_unified_analytics for first-run initialization.\n\n';
  fs.writeFileSync(sqlFile, header + sqlQuery.trim() + ';\n');
  console.log('Successfully synced 002_analytics_views.sql');
}).catch(console.error);
