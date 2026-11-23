# 拉片知识库（Render + Supabase + DeepSeek 全栈版）

通过不断拉片，积累视听语言知识库；下次输入剧本，按知识库生成分镜和视频提示词。

## 功能

- **拉片库**：新增 / 编辑 / 删除镜头，字段包括景别、机位、构图、运镜、光线、画面内容、人物动作、情绪、对白、背景音乐、音效、转场方式、蒙太奇运用、为什么这样用，另有时间码、时长、关键帧缩略图；支持搜索、按情绪筛选；一键提炼到知识库。
- **视听语言知识库**：规律按情绪 / 场景类型 / 节奏分类，可搜索、打标签、新增 / 编辑 / 删除。
- **剧本转分镜**：粘贴剧本，选择情绪、场景类型、节奏，服务端 AI 按知识库生成分镜表，每镜含中英文视频提示词，可复制全部、导出 TXT，生成历史会保存。
- **视频导入**：上传本地视频文件，或粘贴可直接下载的视频文件链接；浏览器本地按画面变化切分镜头（灵敏度可调），预填开始时间码、时长、关键帧；超过 10 分钟会提示先用 5–10 分钟关键段落。草稿自动保存（浏览器本地缓存），切页签、刷新后仍在，中断后可断点恢复；批量存入拉片库后清除草稿。
- **识图预填**：单镜按钮与“批量识图前 10 个”。服务端 DeepSeek 看关键帧图片预填景别、机位、构图、光线、画面内容、人物动作和情绪（推测），并标“AI预填”；运镜、转场、蒙太奇、对白、音乐音效、为什么这样用留空，不编造。
- **顺序预填**：同时看前后镜头、镜头顺序和对白，服务端 AI 推测转场方式、蒙太奇运用和“为什么这样用”，标注“AI预填·推测”。
- **字幕识别**：优先上传 SRT 字幕文件（解析后按时间码对齐填对白，标注来源 SRT）；画面字幕 OCR 通过 Tesseract.js CDN 按需加载，需联网，若加载失败请改用 SRT 或手动填对白。
- **悬停大图**：鼠标停在关键帧缩略图上弹出放大预览（镜头序号、时间码、时长），预览放在行下方 / 空白处，不遮住输入框；触屏点一下打开，再点空白处关闭。

## 部署到 Render

1. 把本仓库连到 Render：New → Web Service → 选择这个 GitHub 仓库。仓库里已有 `render.yaml`，Render 会按它创建服务（Node，`npm install` 构建，`node server.js` 启动）。
2. 在 Render 服务的 Environment 里设置以下环境变量：
   - `AI_API_KEY`：DeepSeek 的 API 密钥
   - `AI_BASE_URL`：DeepSeek 接口地址，例如 `https://api.deepseek.com`
   - `AI_MODEL`：模型名，例如 `deepseek-flash`
   - `SUPABASE_URL`：Supabase 项目地址，例如 `https://your-project.supabase.co`
   - `SUPABASE_SERVICE_ROLE_KEY`：Supabase 的 service_role 密钥（只放服务端，绝不发给浏览器）
   - `SUPABASE_ANON_KEY`（可选，本应用服务端不直接用它）
3. 部署完成后打开 Render 给的地址即可使用。健康检查：`/api/health` 会返回 AI / Supabase 是否已配置（不返回任何密钥值）。

## 创建 Supabase 表

Supabase 控制台 → SQL Editor → 粘贴 `supabase/schema.sql` 的全部内容 → Run。
建表：`shots`（拉片）、`knowledge_items`（知识库）、`storyboards`（分镜历史）、`import_drafts`（导入草稿，可选）。
脚本已开启 RLS；服务端用 service_role 密钥读写，浏览器不直连 Supabase。如需浏览器直连，请自行在控制台添加 policy。

## 本地运行

```bash
npm install
cp .env.example .env   # 然后在 .env 里填入真实值
npm start              # 打开 http://localhost:3000/
```

## 仓库里没有的东西

- **没有任何真实密钥**：`.env` 已加入 `.gitignore`，不会提交；`.env.example` 里只有占位符（如 `your-deepseek-api-key`）。
- AI 密钥只在服务端使用：前端代码里没有任何密钥，浏览器请求只发给同域的 `/api/*`。

## 数据存储

拉片、知识库、分镜历史存在 Supabase（`shots` / `knowledge_items` / `storyboards` 表）。
如果未配置 Supabase，服务仍能启动并用内存存储，同时在日志里警告；**内存存储重启后会丢失**，部署时务必配置 Supabase。
视频导入草稿只存在浏览器 localStorage（离线缓存），批量存入拉片库后清除。
示例数据（5 条拉片、5 条知识）带“示例”标记，可用“一键清空示例”删除，不会删你的数据。

## 诚实说明 / 限制

- **DeepSeek 识图取决于配置的模型是否支持图片**：`deepseek-flash` 等若不支持 vision，识图预填会明确报错，不会编造结果；请换一个支持图片的模型。
- 画面字幕 OCR 需要联网加载 Tesseract.js CDN，识别可能有错字，请逐条核对；最准的是 SRT 字幕文件。
- 视频导入是浏览器本地处理，不会把视频上传到服务器；60 分钟长片请先截 5–10 分钟关键段落。
- 本仓库是独立部署版，与 Muse 托管版不是同一份代码：托管版的改动不会自动同步到这里。

## 文件

- `server.js` — Express 服务：静态前端 + `/api` 接口
- `lib/ai.js` — DeepSeek 调用（服务端专用）
- `lib/store.js` — Supabase 数据层（未配置时降级内存存储）
- `lib/seed.js` — 示例数据
- `public/index.html` / `public/styles.css` / `public/app.js` — 前端
- `supabase/schema.sql` — 建表脚本
- `render.yaml` — Render 部署配置
- `.env.example` — 环境变量模板（占位符）
- `package.json` — 依赖与启动脚本
