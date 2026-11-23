'use strict';
/* 数据层：Supabase 优先；未配置 SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 时，
   服务仍能启动，自动降级为内存存储，并在日志里明确警告。
   内存存储只在单进程、重启即失，部署时务必配置 Supabase。 */

const { createClient } = require('@supabase/supabase-js');

const url = process.env.SUPABASE_URL || '';
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const configured = Boolean(url && serviceKey);

let supabase = null;
if (configured) {
  supabase = createClient(url, serviceKey, { auth: { persistSession: false } });
} else {
  console.warn('[store] Supabase 未配置（缺少 SUPABASE_URL 或 SUPABASE_SERVICE_ROLE_KEY），使用内存存储；重启后数据会丢失。请在 Render 环境变量里配置。');
}

const TABLES = { shots: 'shots', knowledge: 'knowledge_items', storyboards: 'storyboards' };

/* 内存降级存储 */
const memory = { shots: [], knowledge_items: [], storyboards: [] };
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

function rowToRecord(table, row) {
  if (!row) return row;
  if (table === 'shots') {
    return {
      id: row.id, title: row.title, start: row.start, duration: row.duration,
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
  return row;
}

function recordToRow(table, rec) {
  if (table === 'shots') {
    return {
      id: rec.id, title: rec.title, start: rec.start, duration: rec.duration,
      shot_size: rec.shotSize, camera: rec.camera, composition: rec.composition,
      movement: rec.movement, lighting: rec.lighting, content: rec.content,
      action: rec.action, emotion: rec.emotion, dialogue: rec.dialogue,
      music: rec.music, sfx: rec.sfx, transition: rec.transition,
      montage: rec.montage, why: rec.why, thumb: rec.thumb || null,
      sample: Boolean(rec.sample),
    };
  }
  if (table === 'knowledge_items') {
    return {
      id: rec.id, title: rec.title, emotion: rec.emotion, scene: rec.scene,
      rhythm: rec.rhythm, tags: rec.tags || [], description: rec.desc,
      sample: Boolean(rec.sample),
    };
  }
  return rec;
}

async function list(table) {
  if (!configured) return [...memory[table]].sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || ''))).map((r) => rowToRecord(table, r));
  const { data, error } = await supabase.from(table).select('*').order('created_at', { ascending: false });
  if (error) throw error;
  return (data || []).map((r) => rowToRecord(table, r));
}

async function create(table, rec) {
  const row = recordToRow(table, { ...rec, id: rec.id || uid() });
  if (!configured) {
    const stored = { ...row, created_at: new Date().toISOString() };
    memory[table].unshift(stored);
    return rowToRecord(table, stored);
  }
  const { data, error } = await supabase.from(table).insert(row).select().single();
  if (error) throw error;
  return rowToRecord(table, data);
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
  const { data, error } = await supabase.from(table).update(row).eq('id', id).select().single();
  if (error) throw error;
  return rowToRecord(table, data);
}

async function remove(table, id) {
  if (!configured) {
    memory[table] = memory[table].filter((r) => r.id !== id);
    return true;
  }
  const { error } = await supabase.from(table).delete().eq('id', id);
  if (error) throw error;
  return true;
}

async function clearSamples(table) {
  if (!configured) {
    memory[table] = memory[table].filter((r) => !r.sample);
    return true;
  }
  const { error } = await supabase.from(table).delete().eq('sample', true);
  if (error) throw error;
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

module.exports = { configured, TABLES, list, create, update, remove, clearSamples, seedIfEmpty, uid };
