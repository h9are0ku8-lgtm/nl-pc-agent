# 自然言語PCエージェント（MVP）

自然言語の依頼をタスクに分解し、**安全な作業フォルダ内**でファイル操作・PDF処理を実行するローカルエージェントです。

## 重要（できること / まだできないこと）

### できる
- 「inboxを整理して」→ 拡張子ごとにフォルダ分け
- ファイル移動・コピー・リネーム
- PDFテキスト抽出、PDF抜粋のExcel化
- CSV / テキスト作成

### まだできない（次フェーズ）
- 任意サイトからの売上スクレイピング
- メール添付の自動処理
- Slack API連携
- OS画面の完全自動操作

## セットアップ

```bash
npm install
cp .env.example .env   # 任意で GEMINI_API_KEY
npm test
npm start -- "inboxを整理して"
```

実ファイルは `workspace/inbox` に置いてから実行してください。

## 安全策
- 既定では `./workspace` の外を操作しない
- 実行前にプラン確認（`--yes` で省略）
- 任意シェル実行はしない

## ドキュメント
- `docs/01-feature-brainstorm.md`
- `docs/02-requirements.md`
- `docs/03-article-draft.md`
- `docs/04-submission.md`
