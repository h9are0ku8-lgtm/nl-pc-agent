# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

自然言語PCエージェント（ローカルCLI MVP）。  
依頼文をプランに分解し、ワークスペース内のファイル/PDF操作を確認付きで実行する。

## Commands

```bash
npm install
npm test
npm start -- "inboxを整理して"
```

## Architecture

- `src/cli.ts` … 入口
- `src/planner.ts` … Gemini or ルールでプラン生成
- `src/executor.ts` … 確認と実行
- `src/tools.ts` … 許可されたツール実装
- `src/safety.ts` … パス制限

## プロジェクト固有ルール

- コメントは日本語で書く
- テストを行って確認してから実行する
- ワークスペース外への操作を追加しない
