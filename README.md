# Quest Agent v0.1

Quest Agent は、目標はあるのに進め方で止まりがちな人のために、目標を実行可能な流れに変え、実現確率を高める伴走エージェントです。

## 収録内容
- Quest Intake
- Quest Map
- Today’s Quests
- Weekly Review
- Blocker 記録と reroute 提案
- event logging
- Supabase 前提の schema と file fallback

## 技術スタック
- Next.js App Router
- TypeScript
- Supabase
- OpenAI Responses API

## セットアップ
1. 依存関係を入れます

```powershell
npm.cmd install
```

2. 環境変数ファイルを作ります

```powershell
Copy-Item .env.example .env.local
```

3. 任意で `.env.local` に値を入れます
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `OPENAI_API_KEY`
- `OPENAI_MODEL`

値を入れない場合:
- DB は `data/quest-agent-fallback.json` を使います
- AI は heuristic fallback で動きます

## ローカル起動
```powershell
npm.cmd run dev
```

ブラウザで [http://localhost:3000](http://localhost:3000) を開きます。

## ローカル確認
1. `/intake` で goal を作る
2. `/map` で milestone / quest draft を生成して保存する
3. `/today` で quest を started / completed に更新する
4. blocker を追加して reroute 提案を確認する
5. `/review` で weekly review を保存する

## Supabase schema
SQL は [supabase/schema.sql](/C:/Users/oatyu/デスクトップ/quest-agent/supabase/schema.sql) にあります。

## 検証コマンド
```powershell
npm.cmd run lint
npm.cmd run build
```

## ドキュメント
- [docs/quest-agent-v0_1-prd.md](/C:/Users/oatyu/デスクトップ/quest-agent/docs/quest-agent-v0_1-prd.md)
- [docs/quest-agent-v0_1-data-model.md](/C:/Users/oatyu/デスクトップ/quest-agent/docs/quest-agent-v0_1-data-model.md)
- [docs/quest-agent-v0_1-implementation-plan.md](/C:/Users/oatyu/デスクトップ/quest-agent/docs/quest-agent-v0_1-implementation-plan.md)
