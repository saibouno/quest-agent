# Quest Agent

Quest Agent は、
**目標はあるのに進め方で止まりがちな人のために、目標を進められる形に変える実行伴走エージェント** です。

単なる ToDo アプリではなく、次の変換を狙います。

- 曖昧な目標を、達成条件つきの goal にする
- goal を、現実的な route にする
- route を、今日やる 1〜3 個の quest にする
- 止まったら、blocker を言葉にして reroute する
- review して、根性論ではなく設計を直す

## 今できること
この v0.2 準備版では、次の体験を試せます。

- `Quest Intake`
  - 目標、Why、期限、制約、現在地、不安を書く
  - AI または heuristic で goal draft を整える
- `Quest Map`
  - 目標を milestone と quest に分解する
- `Today's Quests`
  - 今日やる候補を見て、着手・完了・blocker 記録をする
- `Weekly Review`
  - 今週の進捗、学び、reroute を保存する

## 今の内部構造
外からは 1 人の Quest Agent に見えますが、内部では 5 つの役割の scaffold を持っています。

- Scout
- Realist
- Skeptic
- Router
- Archivist

ただし、まだ完全なマルチエージェントではありません。
今は **prompt / type / schema / orchestration の土台** まで入っています。

## まず試す方法
### 1. ローカルで動かす
Windows では次を実行します。

```powershell
npm.cmd install
npm.cmd run dev
```

Windows note: if your PowerShell profile causes automation failures, run `npm.cmd run dev` or `npm.cmd run build` from a no-profile shell. In Codex, use `login:false`.

安定した確認用スクリプト:

- `npm.cmd run lint:noprofile`
- `npm.cmd run typecheck:noprofile`
- `npm.cmd run guardrails:noprofile`
- `npm.cmd run dogfood:backup:noprofile`
- `npm.cmd run dogfood:restore:check:noprofile`

ブラウザで [http://localhost:3000](http://localhost:3000) を開いてください。

### 2. 何も設定しなくても試せる
環境変数を入れなくても最低限の体験は動きます。

- OpenAI の key がない場合
  - AI の代わりに heuristic で下書きを返します
- Supabase の設定がない場合
  - ローカル開発では `data/quest-agent-fallback.json` に保存します

## 継続改善の環境役割
Quest Agent の継続改善運用では、役割を次の 3 つに固定します。

- `main`
  - 実装統合の正本
- `preview/demo`
  - 変更確認用 Preview
  - Supabase env は入れない
  - Vercel 上では `browser-local`
  - 保存は使い捨て前提
- `preview/dogfood`
  - 継続利用用 Preview
  - 同じ Supabase project を見続ける
  - deploy 後も同じデータを見続ける前提
  - `browser-local` / `local-file` への fallback を許可しない

画面の Environment 詳細では、deployment target と `server-backed` / `browser-local` を確認できます。

## 環境変数
共有保存や実 AI を使いたい場合は、あとから次を設定します。

```env
QUEST_AGENT_DEPLOYMENT_TARGET=local
QUEST_AGENT_EXPECTED_SUPABASE_URL=
SUPABASE_DB_URL=
QUEST_AGENT_BACKUP_ROOT=
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
# Optional later if the client ever talks to Supabase directly.
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
OPENAI_API_KEY=
OPENAI_MODEL=
```

運用上の契約は次の通りです。

- `preview/demo`
  - `QUEST_AGENT_DEPLOYMENT_TARGET=preview/demo`
  - `SUPABASE_URL` なし
  - `SUPABASE_SERVICE_ROLE_KEY` なし
- `preview/dogfood`
  - `QUEST_AGENT_DEPLOYMENT_TARGET=preview/dogfood`
  - `SUPABASE_URL` あり
  - `SUPABASE_SERVICE_ROLE_KEY` は server env のみ
  - `SUPABASE_DB_URL` は backup / restore 用の server-only secret
  - `QUEST_AGENT_EXPECTED_SUPABASE_URL` は `SUPABASE_URL` と同じ値にして向き先を固定する
- backup は `npm.cmd run dogfood:backup:noprofile`
- restore-check は `npm.cmd run dogfood:restore:check:noprofile`
- live restore は `powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\dogfood-restore.ps1 -Apply`
- 将来 client から直接 Supabase を使う場合でも、使うのは `NEXT_PUBLIC_SUPABASE_URL` と `NEXT_PUBLIC_SUPABASE_ANON_KEY` だけに限定する
- `NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY` は禁止

## この repo の見方
最初に見る場所はここです。

- `README.md`
- `docs/v0_2-agent-architecture.md`
- `docs/v0_2-role-io-contracts.md`
- `docs/vercel-preview-runbook.md`
- `docs/continuous-improvement-operations.md`

role ごとの prompt は `prompts/` にあります。

## 補足
- `SUPABASE_SERVICE_ROLE_KEY` は server 側でしか使いません
- client 側は `browser-local` か `server-backed` かだけを知ります
- Vercel Preview without Supabase では `localStorage` を使います
- `preview/dogfood` は例外で、Supabase 未接続のまま起動しません
- 5役はまだ scaffold で、完全実装ではありません
