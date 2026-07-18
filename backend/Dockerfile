# ---- Build Stage ----
FROM golang:1.22-alpine AS builder

WORKDIR /app

# 依存関係のキャッシュのために先にコピー
COPY go.mod go.sum ./
RUN go mod download

# ソースコードをコピーしてビルド
COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -o server .

# ---- Run Stage ----
FROM alpine:latest

WORKDIR /app

# CA証明書（TLS接続に必要）
RUN apk --no-cache add ca-certificates

COPY --from=builder /app/server .

# Renderが動的に割り当てるPORTを使う
EXPOSE 8000

CMD ["./server"]
