package main

import (
	"context"
	"fmt"
	"log"
	"net/http"
	"os"

	"github.com/go-redis/redis/v8"
)

var (
	ctx = context.Background()
	rdb *redis.Client

	// Redisのキー名パターン
	boardsIndexKey = "whiteboard-boards"     // パブリックボードのリスト
	allBoardsKey   = "whiteboard-boards-all" // 全ボード（パブリック+プライベート）
	boardStateKey  = "whiteboard-state:%s"   // ボードの描画状態（%sはboardId）
	boardMetaKey   = "whiteboard-board:%s"   // ボードのメタデータ（%sはboardId）
	sessionKey     = "whiteboard-session:%s" // アクセスセッション（%sはtoken）
	inviteTokenKey = "whiteboard-invite:%s"  // 招待トークン（%sはtoken）
	ownerTokenKey  = "whiteboard-owner:%s"   // 作成者トークンのハッシュ（%sはboardId）
	channelName    = "whiteboard-draw"
)

func main() {
	// Redisクライアントの初期化
	var redisOpts *redis.Options
	if redisURL := os.Getenv("REDIS_URL"); redisURL != "" {
		opt, err := redis.ParseURL(redisURL)
		if err != nil {
			log.Fatalf("Invalid REDIS_URL: %v", err)
		}
		redisOpts = opt
	} else {
		redisOpts = &redis.Options{
			Addr:     fmt.Sprintf("%s:%s", getEnv("REDIS_HOST", "localhost"), getEnv("REDIS_PORT", "6379")),
			Password: getEnv("REDIS_PASSWORD", ""),
		}
	}
	rdb = redis.NewClient(redisOpts)

	if err := rdb.Ping(ctx).Err(); err != nil {
		log.Fatalf("Redis ping failed: %v", err)
	}

	// Redisからのメッセージを待機するGoroutine
	go handleRedisPubSub()

	// CORSミドルウェアでラップされたハンドラー
	http.HandleFunc("/api/boards", corsMiddleware(handleGetBoards))
	http.HandleFunc("/api/boards/create", corsMiddleware(handleCreateBoard))
	http.HandleFunc("/api/boards/delete", corsMiddleware(handleDeleteBoard))
	http.HandleFunc("/api/boards/join", corsMiddleware(handleJoinBoard))
	http.HandleFunc("/api/boards/info", corsMiddleware(handleBoardInfo))
	http.HandleFunc("/api/boards/invite/create", corsMiddleware(handleCreateInvite))
	http.HandleFunc("/api/boards/invite/use", corsMiddleware(handleUseInvite))

	// WebSocket接続のエンドポイント
	http.HandleFunc("/ws", handleConnections)

	port := getEnv("PORT", "8000")
	fmt.Printf("Server started on :%s\n", port)
	err := http.ListenAndServe(":"+port, nil)
	if err != nil {
		log.Fatal("ListenAndServe: ", err)
	}
}

// corsMiddleware はCORSヘッダーを追加するミドルウェア
func corsMiddleware(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type")

		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusOK)
			return
		}

		next(w, r)
	}
}

func getEnv(key, defaultValue string) string {
	if val := os.Getenv(key); val != "" {
		return val
	}
	return defaultValue
}
