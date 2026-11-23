-- 拉片知识库 — Supabase 建表脚本
-- 使用方法：Supabase 控制台 → SQL Editor → 粘贴本文件 → Run。
-- 注意：本脚本默认开启 RLS（行级安全）但不自动放行所有读写。
-- 本应用是单人自用部署：服务端用 SUPABASE_SERVICE_ROLE_KEY 绕过 RLS 读写，
-- 浏览器不直接连 Supabase，所有请求都走 Render 上的 Node 服务。
-- 如果你要让浏览器直连 Supabase，请先在控制台按需添加 policy，并改用 anon key。
-- 下面同时给出一个“仅允许 service_role 读写”的说明性 policy（默认已满足，无需额外操作）。

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
  thumb text,          -- 关键帧 data URL（较大时建议改存 Storage，只存链接）
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

-- 开启 RLS（行级安全）
alter table public.shots enable row level security;
alter table public.knowledge_items enable row level security;
alter table public.storyboards enable row level security;
alter table public.import_drafts enable row level security;

-- 说明：service_role 密钥天然绕过 RLS，供服务端使用；
-- 下面不创建面向 anon / authenticated 的读写 policy，
-- 因此浏览器直连 Supabase 时默认读不到数据，这是故意的（防误开）。
-- 如需浏览器直连，请在 Supabase 控制台自行添加 policy，并自行承担风险。
