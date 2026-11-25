'use strict';
/* 数据层：Neon Postgres（Lakebase Postgres）优先；未配置 DATABASE_URL 时，
   服务仍能启动，自动降级为内存存储，并在日志里明确警告。
   内存存储只在单进程、重启即失，部署时务必配置 Neon。
   驱动：@neondatabase/serverless（HTTP 传输），用池化连接串 DATABASE_URL 做应用流量；
   建表/迁移用直连串 DATABASE_URL_UNPOOLED（见 neon/schema.sql 与 scripts/apply-schema.js）。
   本来长驻型 Node 应用按 Neon 技能首选 node-postgres（pg），但本机沙箱禁了直连
   数据库的 TCP 协议（5432 端口），pg 连不上；HTTP 驱动走 443 端口，在本机和
   Render 上都能用，单人用的拉片应用流量很小，够用。以后若在 Muse 设置里把
   “直接网络协议 → 数据库”从拒绝改成询问，可把本文件换回 pg 连接池，接口不变。
   Neon Auth 与 Realtime 已在项目里开通，但本应用无登录、无实时查询，未接入。 */

const { neon } = require('@neondatabase/serverless');

const databaseUrl = process.env.DATABASE_URL || '';
const configured = Boolean(databaseUrl);

let sql = null;
if (configured) {
  sql = neon(databaseUrl);
} else {
  console.warn('[store] Neon 未配置（缺少 DATABASE_URL），使用内存存储；重启后数据会丢失。请在 Render 环境变量里配置 DATABASE_URL。');
}

const TABLES = { shots: 'shots', knowledge: 'knowledge_items', storyboards: 'storyboards' };

/* 内存降级存储 */
const memory = { shots: [], knowledge_items: [], storyboards: [] };
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

function rowToRecord(table, row) {
  if (!row) return row;
  if (table === 'shots') {
    return {
      id: row.id, title: row.title, start: row.start, duration: Number(row.duration),
      shotSize: row.shot_size, camera: row.camera, composition: row.composition,
      movement: row.movement, lighting: row.lighting, content: row.content,
      action: row.action, emotion: row.emotion, dialogue: row.dialogue,
      music: row.music, sfx: row.sfx, transition: row.transition,
      montage: row.montage, why: row.why, thumb: row.thumb || '',
      sample: Boolean(row.sample), created_at: row.created_at,
    };
  }
  if (table === 'knowledge_items') {
    return {
      id: row.id, title: row.title, emotion: row.emotion, scene: row.scene,
      rhythm: row.rhythm, tags: row.tags || [], desc: row.description,
      sample: Boolean(row.sample), created_at: row.created_at,
    };
  }
  if (table === 'storyboards') {
    return {
      id: row.id, script: row.script, emotion: row.emotion, scene: row.scene,
      rhythm: row.rhythm, lines: row.lines, shots: row.shots || [],
      created_at: row.created_at,
    };
  }
  return row;
}

function recordToRow(table, rec) {
  if (table === 'shots') {
    return {
      id: rec.id, title: rec.title ?? '', start: rec.start ?? '00:00', duration: rec.duration ?? 0,
      shot_size: rec.shotSize ?? '', camera: rec.camera ?? '', composition: rec.composition ?? '',
      movement: rec.movement ?? '', lighting: rec.lighting ?? '', content: rec.content ?? '',
      action: rec.action ?? '', emotion: rec.emotion ?? '', dialogue: rec.dialogue ?? '',
      music: rec.music ?? '', sfx: rec.sfx ?? '', transition: rec.transition ?? '',
      montage: rec.montage ?? '', why: rec.why ?? '', thumb: rec.thumb || null,
      sample: Boolean(rec.sample),
    };
  }
  if (table === 'knowledge_items') {
    return {
      id: rec.id, title: rec.title ?? '', emotion: rec.emotion ?? '', scene: rec.scene ?? '',
      rhythm: rec.rhythm ?? '', tags: rec.tags || [], description: rec.desc ?? '',
      sample: Boolean(rec.sample),
    };
  }
  if (table === 'storyboards') {
    return {
      id: rec.id, script: rec.script ?? '', emotion: rec.emotion ?? '', scene: rec.scene ?? '',
      rhythm: rec.rhythm ?? '', lines: rec.lines ?? 0, shots: rec.shots || [],
    };
  }
  return rec;
}

async function list(table) {
  if (!configured) return [...memory[table]].sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || ''))).map((r) => rowToRecord(table, r));
  const rows = await sql.query(`SELECT * FROM ${table} ORDER BY created_at DESC`);
  return rows.map((r) => rowToRecord(table, r));
}

async function create(table, rec) {
  const row = recordToRow(table, { ...rec, id: rec.id || uid() });
  if (!configured) {
    const stored = { ...row, created_at: new Date().toISOString() };
    memory[table].unshift(stored);
    return rowToRecord(table, stored);
  }
  const keys = Object.keys(row);
  const cols = keys.join(', ');
  const placeholders = keys.map((_, i) => `$${i + 1}`).join(', ');
  const values = keys.map((k) => (k === 'shots' ? JSON.stringify(row[k]) : row[k]));
  const rows = await sql.query(
    `INSERT INTO ${table} (${cols}) VALUES (${placeholders}) RETURNING *`,
    values,
  );
  return rowToRecord(table, rows[0]);
}

async function update(table, id, rec) {
  const row = recordToRow(table, { ...rec, id });
  delete row.id;
  if (!configured) {
    const i = memory[table].findIndex((r) => r.id === id);
    if (i < 0) return null;
    memory[table][i] = { ...memory[table][i], ...row };
    return rowToRecord(table, memory[table][i]);
  }
  const keys = Object.keys(row);
  const setClause = keys.map((k, i) => `${k} = $${i + 1}`).join(', ');
  const values = keys.map((k) => (k === 'shots' ? JSON.stringify(row[k]) : row[k]));
  values.push(id);
  const rows = await sql.query(
    `UPDATE ${table} SET ${setClause} WHERE id = $${values.length} RETURNING *`,
    values,
  );
  return rows.length ? rowToRecord(table, rows[0]) : null;
}

async function remove(table, id) {
  if (!configured) {
    memory[table] = memory[table].filter((r) => r.id !== id);
    return true;
  }
  await sql.query(`DELETE FROM ${table} WHERE id = $1`, [id]);
  return true;
}

async function clearSamples(table) {
  if (!configured) {
    memory[table] = memory[table].filter((r) => !r.sample);
    return true;
  }
  await sql.query(`DELETE FROM ${table} WHERE sample = true`);
  return true;
}

async function seedIfEmpty() {
  // 只在完全没有任何数据时写入示例（5 条拉片 + 5 条知识），并标 sample=true。
  const shots = await list('shots');
  const knowledge = await list('knowledge_items');
  if (shots.length === 0 && knowledge.length === 0) {
    const seed = require('./seed');
    for (const s of seed.shots) await create('shots', s);
    for (const k of seed.knowledge) await create('knowledge_items', k);
    console.log('[store] 已写入示例数据（5 条拉片 + 5 条知识，标“示例”）。');
  }
}

/* ---- 视频导入草稿（服务端持久化，单人用，只存一条 id='current'） ----
   import_drafts 表的 shots jsonb 列存整份草稿对象（含 shots 数组、分段进度
   segmented / segments / segmentDuration、savedAt），title / phase 两列只做
   镜像方便查看；不加列、不动其他三张表。草稿只在用户手动清除或批量存入
   拉片库时删除，刷新、换设备、换浏览器后下次打开都恢复同样的镜头和数量。 */
const DRAFT_ID = 'current';
let memoryDraft = null; /* Neon 未配置时的内存降级：单进程、重启即失（与其它表一致） */

function rowToDraft(row) {
  if (!row) return null;
  const d = row.shots;
  if (d && typeof d === 'object' && Array.isArray(d.shots)) return d;
  return null;
}

async function getDraft() {
  if (!configured) return memoryDraft;
  const rows = await sql.query('SELECT * FROM import_drafts WHERE id = $1', [DRAFT_ID]);
  return rows.length ? rowToDraft(rows[0]) : null;
}

async function saveDraft(draft) {
  if (!draft || !Array.isArray(draft.shots)) throw new Error('草稿格式不正确（缺少镜头列表）');
  if (!configured) { memoryDraft = draft; return draft; }
  const rows = await sql.query(
    `INSERT INTO import_drafts (id, title, phase, shots, updated_at) VALUES ($1, $2, $3, $4, now())
     ON CONFLICT (id) DO UPDATE SET title = EXCLUDED.title, phase = EXCLUDED.phase, shots = EXCLUDED.shots, updated_at = now()
     RETURNING *`,
    [DRAFT_ID, draft.title || '', draft.phase || '', JSON.stringify(draft)],
  );
  return rowToDraft(rows[0]);
}

async function deleteDraft() {
  if (!configured) { memoryDraft = null; return true; }
  await sql.query('DELETE FROM import_drafts WHERE id = $1', [DRAFT_ID]);
  /* 立即 VACUUM：DELETE 只标记死元组，文件大小不变；VACUUM 后数据库已用
     空间马上降下来，用户在导入页看到的用量就是真实用量。单人用的小表，
     失败也不影响删除本身（best-effort）。 */
  try { await sql.query('VACUUM import_drafts'); } catch (e) { console.warn('[store] VACUUM import_drafts 失败（空间稍后由 autovacuum 回收）：', e.message); }
  return true;
}

/* 数据库用量（字节）：供导入页显示“已用 X MB / 免费额度”；Neon 未配置返回 null，
   客户端显示“暂不可用”，不编数字。 */
async function getDbSize() {
  if (!configured) return null;
  const rows = await sql.query('SELECT pg_database_size(current_database()) AS bytes');
  const bytes = Number(rows[0] && rows[0].bytes);
  return Number.isFinite(bytes) ? bytes : null;
}

module.exports = { configured, TABLES, list, create, update, remove, clearSamples, seedIfEmpty, uid, getDraft, saveDraft, deleteDraft, getDbSize };
