# Quest Agent

Quest Agent は、
**目標はあるのに進め方で止まりがちな人のために、目標を進められる形に変える実行伴走エージェント** です。

これは単なる ToDo アプリではありません。
Quest Agent が目指しているのは、次の変換です。

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

ブラウザで [http://localhost:3000](http://localhost:3000) を開いてください。

### 2. 何も設定しなくても試せる
環境変数を入れなくても、最低限の体験は動きます。

- OpenAI の key がない場合
  - AI の代わりに heuristic で下書きを返します
- Supabase の設定がない場合
  - ローカル開発では `data/quest-agent-fallback.json` に保存します

## 公開版を触るとき
Quest Agent は Vercel に置くと、URL で開ける Web アプリになります。

### Vercel ってなに
Vercel は、
**このアプリをネット上で見られるようにする場所** です。

ローカル実行との違いはこうです。

- ローカル実行
  - 自分の PC でだけ見られる
- Vercel Preview
  - URL で開ける
  - スマホや別 PC でも確認できる
  - 他の人に見せやすい

## Preview 版の制限
Supabase をまだつないでいない Preview 版では、保存先はブラウザの中だけです。

つまり、Preview では次の制限があります。

- 保存はそのブラウザにだけ残る
- 別の端末には引き継がれない
- 他の人と共有されない
- 共有保存は Supabase 接続後に対応する

この仕様は、Vercel Preview でも安全に動くようにするためです。

## 環境変数
共有保存や実AIを使いたい場合は、あとから次を設定します。

```env
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
OPENAI_API_KEY=
OPENAI_MODEL=
```

## この repo の見方
最初に見る場所はここです。

- `README.md`
- `docs/v0_2-agent-architecture.md`
- `docs/v0_2-role-io-contracts.md`
- `docs/vercel-preview-runbook.md`

role ごとの prompt は `prompts/` にあります。

## 補足
- `SUPABASE_SERVICE_ROLE_KEY` は server 側でしか使いません
- client 側は `browser-local` か `server-backed` かだけを知ります
- Vercel Preview without Supabase では `localStorage` を使います
- 5役はまだ scaffold で、完全実装ではありません