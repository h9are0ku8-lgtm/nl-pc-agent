# 自然言語PCエージェント（MVP）

自然言語の依頼をタスクに分解し、**安全な作業フォルダ内**でファイル操作・PDF処理・公開URL取得を実行するローカルエージェントです。

## できること
- inbox整理（拡張子ごと）
- 直近ファイルを `slack` フォルダへ移動
- ファイル移動・コピー・リネーム
- PDFテキスト抽出、PDF→Excel要約（`GEMINI_API_KEY` があればAI要約）
- 公開URLの表/JSON → CSV保存
- CSV / テキスト作成

## まだできない（次フェーズ）
- ログイン必須サイトの取得
- 実メールクライアント操作
- Slack API送信（今はローカル `slack/` フォルダ）
- OS画面の完全自動操作

## セットアップ

```bash
npm install
cp .env.example .env   # 任意で GEMINI_API_KEY
npm test
npm start -- "inboxを整理して"
npm start -- "昨日作ったファイルを全部Slack用フォルダへ移動"
npm start -- "https://jsonplaceholder.typicode.com/users から取得してCSV保存"
```

実ファイルは `workspace/inbox` に置いてから実行してください。

## 安全策
- 既定では `./workspace` の外を操作しない
- localhost / プライベートIPへのWeb取得は禁止
- 実行前にプラン確認（`--yes` で省略）
- 任意シェル実行はしない

## ドキュメント
- `docs/01-feature-brainstorm.md`
- `docs/02-requirements.md`
- `docs/03-article-draft.md`
- `docs/04-submission.md`

リポジトリ: https://github.com/h9are0ku8-lgtm/nl-pc-agent
