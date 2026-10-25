# シェアホワ

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

**シェアホワ** は、Go と React(TypeScript) で実装されたリアルタイム共有ホワイトボードアプリです。URLを共有するだけで使えます。
複数ユーザーが同じボード上で同時に描画・操作でき、WebSocket と Redis Pub/Sub による低遅延同期を備えています。

※Renderの無料分でしか動かないので注意（無料分を使い切るとボードの作成に失敗する）

公開サイト: https://kuru99.github.io/SharedWhiteboard/

---

## 使用技術

| 分類 | 技術 |
|---|---|
| フロントエンド | React、TypeScript、Vite |
| バックエンド | Go |
| リアルタイム通信 | WebSocket |
| データ共有 | Redis Pub/Sub |
| 開発・実行環境 | Docker、Docker Compose |
| フロントエンドの公開先 | GitHub Pages |
| バックエンドの公開先 | Render |

## 特徴

- リアルタイム描画共有
- WebSocket ベースの双方向通信
- Redis Pub/Sub によるクラスタ構成対応
- デスクトップ/スマホのタッチ操作に対応
- Vite + React + TypeScript による高速 UI
- Dockerを利用したGoバックエンドのコンテナ化
- パブリックとプライベートのホワイトボードの作成
- 基本的にボードは作成者のみ削除可能

## 管理者機能

- 管理者向けのページから、ボードの一覧確認や削除を行えます。通常の利用では使用しない、管理用の機能です。

## ライセンス

MIT License

---

## 👤 作者

- **kuru99**
