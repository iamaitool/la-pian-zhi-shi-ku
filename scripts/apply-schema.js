'use strict';
/* 建表：用直连串 DATABASE_URL_UNPOOLED 执行 neon/schema.sql。
   用法：node scripts/apply-schema.js
   连接串来源（按顺序）：环境变量 DATABASE_URL_UNPOOLED，否则读项目根目录的
   .env.local（Neon deploy 写入的本地文件，gitignored，绝不提交）。
   用 @neondatabase/serverless（HTTP 传输）执行：直连 TCP 5432 在某些沙箱里被禁，
   HTTP 驱动走 443 端口；每次调用只执行一条语句，所以按分号拆开逐条跑。 */
const fs = require('fs');
const path = require('path');
const { neon } = require('@neondatabase/serverless');

function loadEnvFile(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)=(.*)\s*$/);
    if (m && !process.env[m[1]]) {
      let v = m[2].trim();
      if (v.length >= 2 && v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
      process.env[m[1]] = v;
    }
  }
}

async function main() {
  loadEnvFile(path.join(__dirname, '..', '.env.local'));
  const url = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL || '';
  if (!url) {
    console.error('缺少 DATABASE_URL_UNPOOLED（或 DATABASE_URL）。请先跑 neon deploy，或在 .env.local 里配置。');
    process.exit(1);
  }
  const sqlText = fs.readFileSync(path.join(__dirname, '..', 'neon', 'schema.sql'), 'utf8');
  const sql = neon(url);
  const statements = sqlText
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n')
    .split(/;\s*\n/)
    .map((s) => s.trim())
    .filter(Boolean);
  for (const stmt of statements) await sql.query(stmt);
  const rows = await sql.query(
    "SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name IN ('shots','knowledge_items','storyboards','import_drafts') ORDER BY table_name",
  );
  console.log('建表完成，存在的表：' + rows.map((r) => r.table_name).join(', '));
}

main().catch((e) => { console.error('建表失败：', e.message); process.exit(1); });
