package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"sync"
	"time"

	"github.com/go-redis/redis/v8"
	"github.com/google/uuid"
	"github.com/gorilla/websocket"
)

var (
	ctx = context.Background()
	rdb *redis.Client

	// WebSocketの設定
	upgrader = websocket.Upgrader{
		CheckOrigin: func(r *http.Request) bool {
			return true // 開発用：全てのドメインからの接続を許可
		},
	}

	// 接続されているクライアントを管理（ボードID -> クライアント接続）
	boardClients = make(map[string]map[*websocket.Conn]bool)
	clientsMu    sync.Mutex

	// Redisのキー名パターン
	boardsIndexKey = "whiteboard-boards"   // ボードのリスト
	boardStateKey  = "whiteboard-state:%s" // ボードの描画状態（%sはboardId）
	boardMetaKey   = "whiteboard-board:%s" // ボードのメタデータ（%sはboardId）
	channelName    = "whiteboard-draw"
)

// Board はホワイトボードのメタデータ
type Board struct {
	ID        string    `json:"id"`
	Title     string    `json:"title"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

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

func handleConnections(w http.ResponseWriter, r *http.Request) {
	// boardIdをクエリパラメータから取得
	boardId := r.URL.Query().Get("boardId")
	if boardId == "" {
		boardId = "default" // デフォルトボード
	}

	// HTTP接続をWebSocketにアップグレード
	ws, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Printf("Upgrade error: %v", err)
		return
	}
	defer ws.Close()

	// 新クライアントに既存の描画状態を送信
	sendStateToBoardClient(ws, boardId)

	clientsMu.Lock()
	if boardClients[boardId] == nil {
		boardClients[boardId] = make(map[*websocket.Conn]bool)
	}
	boardClients[boardId][ws] = true
	clientsMu.Unlock()

	log.Printf("New client connected to board: %s", boardId)

	for {
		// クライアントからメッセージを受信
		_, msg, err := ws.ReadMessage()
		if err != nil {
			log.Printf("Client disconnected or error: %v", err)
			clientsMu.Lock()
			delete(boardClients[boardId], ws)
			clientsMu.Unlock()
			break
		}

		// 状態ストアを更新（ボードIDを指定）
		updateBoardState(boardId, msg)

		// 受信したメッセージをRedisにパブリッシュ
		msgWithBoard := addBoardIdToMessage(msg, boardId)
		err = rdb.Publish(ctx, channelName, msgWithBoard).Err()
		if err != nil {
			log.Printf("Redis publish error: %v", err)
		}
	}
}

// sendStateToBoardClient は新たに接続したクライアントに保存済みの状態を全て送信する
func sendStateToBoardClient(ws *websocket.Conn, boardId string) {
	key := fmt.Sprintf(boardStateKey, boardId)
	msgs, err := rdb.LRange(ctx, key, 0, -1).Result()
	if err != nil {
		log.Printf("Redis LRange error: %v", err)
		return
	}
	for _, msg := range msgs {
		if err := ws.WriteMessage(websocket.TextMessage, []byte(msg)); err != nil {
			log.Printf("Error sending state to new client: %v", err)
			return
		}
	}
	log.Printf("Sent %d historical messages to new client for board %s", len(msgs), boardId)
}

// updateBoardState はメッセージの種類に応じてRedisの状態ストアを更新する
func updateBoardState(boardId string, msg []byte) {
	var data map[string]interface{}
	if err := json.Unmarshal(msg, &data); err != nil {
		return
	}

	msgType, _ := data["type"].(string)
	key := fmt.Sprintf(boardStateKey, boardId)

	switch msgType {
	case "draw_step", "text":
		// 描画・テキストメッセージは履歴に追記する
		if err := rdb.RPush(ctx, key, string(msg)).Err(); err != nil {
			log.Printf("Redis RPush error: %v", err)
		}
	case "undo":
		// 指定IDの全メッセージを履歴から削除する
		id, _ := data["id"].(string)
		if id != "" {
			removeFromBoardState(boardId, id)
		}
	case "clear":
		// 履歴を全消去する
		if err := rdb.Del(ctx, key).Err(); err != nil {
			log.Printf("Redis Del error: %v", err)
		}
	}
}

// removeFromBoardState は指定IDに対応する全メッセージを状態ストアから削除する
func removeFromBoardState(boardId, id string) {
	key := fmt.Sprintf(boardStateKey, boardId)
	msgs, err := rdb.LRange(ctx, key, 0, -1).Result()
	if err != nil {
		log.Printf("Redis LRange error: %v", err)
		return
	}

	// 一旦全削除し、対象ID以外を再登録する
	if err := rdb.Del(ctx, key).Err(); err != nil {
		log.Printf("Redis Del error: %v", err)
		return
	}
	for _, msg := range msgs {
		var data map[string]interface{}
		if err := json.Unmarshal([]byte(msg), &data); err != nil {
			rdb.RPush(ctx, key, msg)
			continue
		}
		if dataId, ok := data["id"].(string); ok && dataId == id {
			continue // このIDは削除対象なのでスキップ
		}
		rdb.RPush(ctx, key, msg)
	}
}

// addBoardIdToMessage はメッセージにboardIdフィールドを追加する
func addBoardIdToMessage(msg []byte, boardId string) string {
	var data map[string]interface{}
	if err := json.Unmarshal(msg, &data); err != nil {
		return string(msg)
	}
	data["boardId"] = boardId
	jsonMsg, _ := json.Marshal(data)
	return string(jsonMsg)
}

// handleGetBoards はボード一覧を返す
func handleGetBoards(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	// ボード一覧のキーを取得
	boardIds, err := rdb.SMembers(ctx, boardsIndexKey).Result()
	if err != nil {
		log.Printf("Failed to get board IDs: %v", err)
		http.Error(w, "Internal Server Error", http.StatusInternalServerError)
		return
	}

	boards := []Board{} // nilではなく空配列を初期化
	for _, boardId := range boardIds {
		metaKey := fmt.Sprintf(boardMetaKey, boardId)
		boardData, err := rdb.Get(ctx, metaKey).Result()
		if err == redis.Nil {
			continue
		} else if err != nil {
			log.Printf("Failed to get board %s: %v", boardId, err)
			continue
		}
		var board Board
		if err := json.Unmarshal([]byte(boardData), &board); err != nil {
			log.Printf("Failed to unmarshal board %s: %v", boardId, err)
			continue
		}
		boards = append(boards, board)
	}

	json.NewEncoder(w).Encode(boards)
}

// handleCreateBoard は新しいボードを作成する
func handleCreateBoard(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req struct {
		Title string `json:"title"`
	}

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		log.Printf("Failed to decode request: %v", err)
		http.Error(w, "Invalid request", http.StatusBadRequest)
		return
	}

	if req.Title == "" {
		req.Title = "Untitled Board"
	}

	boardId := uuid.New().String()
	board := Board{
		ID:        boardId,
		Title:     req.Title,
		CreatedAt: time.Now(),
		UpdatedAt: time.Now(),
	}

	boardData, err := json.Marshal(board)
	if err != nil {
		log.Printf("Failed to marshal board: %v", err)
		http.Error(w, "Internal Server Error", http.StatusInternalServerError)
		return
	}

	metaKey := fmt.Sprintf(boardMetaKey, boardId)

	if err := rdb.Set(ctx, metaKey, string(boardData), 0).Err(); err != nil {
		log.Printf("Failed to save board metadata: %v", err)
		http.Error(w, "Internal Server Error", http.StatusInternalServerError)
		return
	}

	if err := rdb.SAdd(ctx, boardsIndexKey, boardId).Err(); err != nil {
		log.Printf("Failed to add board to index: %v", err)
		http.Error(w, "Internal Server Error", http.StatusInternalServerError)
		return
	}

	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(board)
}

// handleDeleteBoard はボードを削除する
func handleDeleteBoard(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req struct {
		BoardId string `json:"boardId"`
	}

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request", http.StatusBadRequest)
		return
	}

	metaKey := fmt.Sprintf(boardMetaKey, req.BoardId)
	stateKey := fmt.Sprintf(boardStateKey, req.BoardId)

	rdb.Del(ctx, metaKey)
	rdb.Del(ctx, stateKey)
	rdb.SRem(ctx, boardsIndexKey, req.BoardId)

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(map[string]string{"status": "deleted"})
}

func getEnv(key, defaultValue string) string {
	if val := os.Getenv(key); val != "" {
		return val
	}
	return defaultValue
}

func handleRedisPubSub() {
	pubsub := rdb.Subscribe(ctx, channelName)
	defer pubsub.Close()

	// チャンネルからのメッセージを取得
	ch := pubsub.Channel()

	for msg := range ch {
		// Redisから受け取ったメッセージを、対応するボードのクライアントに送信
		broadcastToLocalClients([]byte(msg.Payload))
	}
}

func broadcastToLocalClients(msg []byte) {
	// メッセージからboardIdを抽出
	var data map[string]interface{}
	if err := json.Unmarshal(msg, &data); err != nil {
		return
	}

	boardId, ok := data["boardId"].(string)
	if !ok {
		boardId = "default"
	}

	clientsMu.Lock()
	defer clientsMu.Unlock()

	if clients, exists := boardClients[boardId]; exists {
		for client := range clients {
			err := client.WriteMessage(websocket.TextMessage, msg)
			if err != nil {
				log.Printf("Write error: %v", err)
				client.Close()
				delete(clients, client)
			}
		}
	}
}
