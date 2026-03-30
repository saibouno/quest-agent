# Quest Agent v0.1 Implementation Plan

## 実装順
1. docs を正本として作成する
2. Next.js App Router と共通レイアウトを立ち上げる
3. 共通型、validation、derived logic、server store を作る
4. Quest Intake を作り、goal 保存と AI refine を通す
5. Quest Map を作り、milestone / quest draft の保存を通す
6. Today’s Quests を作り、quest 着手 / 完了 / blocker 追加を通す
7. Weekly Review を作り、review 保存と reroute event を通す
8. README とローカル確認手順を整える

## AI integration points
- `POST /api/ai/intake-refine`
- `POST /api/ai/generate-map`
- `POST /api/ai/plan-today`
- `POST /api/ai/reroute-from-blocker`

## AI 実装方針
- OpenAI Responses API を server-side `fetch` で呼ぶ
- Structured Outputs を使い、UI では JSON をそのまま扱う
- API key がない場合は heuristic fallback を返し、操作自体は止めない
- AI が返した内容は自動保存せず、ユーザー確認後に保存する

## Server-side data access
- `SUPABASE_URL` と `SUPABASE_SERVICE_ROLE_KEY` が揃っていれば Supabase を使う
- 未設定なら `data/quest-agent-fallback.json` を使う
- state table の変更と event 追加を同一処理の中で行う

## Environment variables
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `OPENAI_API_KEY`
- `OPENAI_MODEL` default: `gpt-5-mini`

## Local verification
1. `.env.local` を `.env.example` から作る
2. AI なしで `npm.cmd run dev` を起動する
3. Intake -> Map -> Today -> Review を一通り操作する
4. `npm.cmd run lint:noprofile`
5. `npm.cmd run build:noprofile`

## Non-goals
- 認証
- 課金
- 複数ユーザー共有
- 自律的な長時間実行
- 大規模な管理ダッシュボード
