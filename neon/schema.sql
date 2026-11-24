-- 拉片知识库 — Neon Postgres（Lakebase Postgres）建表脚本
-- 与 supabase/schema.sql 表结构一致（shots / knowledge_items / storyboards / import_drafts）。
-- 使用方法：用直连串 DATABASE_URL_UNPOOLED 跑，例如
--   node scripts/apply-schema.js
-- 或在 Neon 控制台 SQL Editor 里粘贴本文件执行。
-- 注意：本应用是单人自用部署，浏览器不直接连数据库，所有请求都走 Render 上的
-- Node 服务；因此这里不开启 RLS——只有服务端用 DATABASE_URL 读写。
-- 关键帧目前仍以 data URL 存在 shots.thumb 列（较大时可改存 Neon Object Storage，只存链接）。

-- 拉片库：每条镜头一条记录
create table if not exists public.shots (
  id text primary key,
  title text not null default '',
  start text not null default '00:00',
  duration numeric not null default 0,
  shot_size text default '',
  camera text default '',
  composition text default '',
  movement text default '',
  lighting text default '',
  content text default '',
  action text default '',
  emotion text default '',
  dialogue text default '',
  music text default '',
  sfx text default '',
  transition text default '',
  montage text default '',
  why text default '',
  thumb text,          -- 关键帧 data URL（较大时建议改存 Object Storage，只存链接）
  sample boolean not null default false,
  created_at timestamptz not null default now()
);

-- 视听语言知识库：每条规律一条记录
create table if not exists public.knowledge_items (
  id text primary key,
  title text not null default '',
  emotion text default '',
  scene text default '',
  rhythm text default '',
  tags text[] not null default '{}',
  description text default '',
  sample boolean not null default false,
  created_at timestamptz not null default now()
);

-- 分镜历史：每次剧本转分镜保存一条
create table if not exists public.storyboards (
  id text primary key,
  script text default '',
  emotion text default '',
  scene text default '',
  rhythm text default '',
  lines integer not null default 0,
  shots jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

-- 视频导入草稿（可选）：服务端不强制使用，浏览器本地 localStorage 已可做草稿缓存；
-- 如需多设备同步草稿，可启用此表。
create table if not exists public.import_drafts (
  id text primary key,
  title text default '',
  phase text default '',
  shots jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);
