# SharedWhiteboard

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

**SharedWhiteboard** は、Go と React(TypeScript) で実装されたリアルタイム共有ホワイトボードアプリです。
複数ユーザーが同じボード上で同時に描画・操作でき、WebSocket と Redis Pub/Sub による低遅延同期を備えています。

---

## 特徴

- リアルタイム描画共有
- WebSocket ベースの双方向通信
- Redis Pub/Sub によるクラスタ構成対応
- デスクトップ/スマホのタッチ操作に対応
- Vite + React + TypeScript による高速 UI
- Docker でインフラを構築可能

---

## リポジトリ構成

- `backend/`
  - Go サーバー
  - WebSocket 接続と Redis Pub/Sub 連携
- `frontend/`
  - React + TypeScript クライアント
  - WebSocket 経由の描画同期
- `docker-compose.yml`
  - Redis を含む開発用スタック
- `test-client/`
  - シンプルな動作確認用クライアント

---

## ローカル開発のセットアップ

### 1. 事前準備

- Docker / Docker Compose
- Go 1.20 以上
- Node.js / npm

### 2. インフラを起動

```bash
docker-compose up -d
```

### 3. バックエンドを起動

```bash
cd backend
go mod download
go run main.go
```

### 4. フロントエンドを起動

```bash
cd frontend
npm install
npm run dev
```

> フロントエンドは通常 `http://localhost:5173` で起動します。

---

## 公開構成 (GitHub Pages + Railway)

このプロジェクトは次のような公開構成を想定しています。

- フロントエンド: GitHub Pages
- バックエンド: Railway などのクラウドサービス
- Redis: Railway プラグインまたは外部Redis

---

## アーキテクチャ

- クライアントは WebSocket で Go サーバーに接続
- サーバーは受信した描画イベントを Redis Pub/Sub 経由で他インスタンスへ転送
- 複数サーバー構成でも同一ボードを共有可能

---

## 注意点

- `frontend/.env` に API / WebSocket の公開 URL を指定してください
- GitHub Pages は静的ファイルのみ公開可能です
- バックエンドは別途クラウドサービスで公開してください
- パレッドの挙動修正完了6/12

---

## ライセンス

MIT License

---

## 👤 作者

- **kuru99**

