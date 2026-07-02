package main

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"strings"
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
	boardsIndexKey   = "whiteboard-boards"         // パブリックボードのリスト
	allBoardsKey     = "whiteboard-boards-all"      // 全ボード（パブリック+プライベート）
	boardStateKey    = "whiteboard-state:%s"        // ボードの描画状態（%sはboardId）
	boardMetaKey     = "whiteboard-board:%s"        // ボードのメタデータ（%sはboardId）
	sessionKey       = "whiteboard-session:%s"      // アクセスセッション（%sはtoken）
	inviteTokenKey   = "whiteboard-invite:%s"       // 招待トークン（%sはtoken）
	channelName      = "whiteboard-draw"
)

// Role はボードへのアクセス権限
type Role string

const (
	RoleEditor Role = "editor"
	RoleViewer Role = "viewer"
)

// Visibility はボードの公開範囲
type Visibility string

const (
	VisibilityPublic  Visibility = "public"
	VisibilityPrivate Visibility = "private"
)

// Board はホワイトボードのメタデータ
type Board struct {
	ID           string     `json:"id"`
	Title        string     `json:"title"`
	Visibility   Visibility `json:"visibility"`
	EditPassword string     `json:"edit_password,omitempty"`
	ViewPassword string     `json:"view_password,omitempty"`
	OwnerID      string     `json:"owner_id"`
	CreatedAt    time.Time  `json:"created_at"`
	UpdatedAt    time.Time  `json:"updated_at"`
}

// BoardPublic はパスワードを除いた公開用メタデータ
type BoardPublic struct {
	ID         string     `json:"id"`
	Title      string     `json:"title"`
	Visibility Visibility `json:"visibility"`
	OwnerID    string     `json:"owner_id"`
	CreatedAt  time.Time  `json:"created_at"`
	UpdatedAt  time.Time  `json:"updated_at"`
}

// Session はアクセストークンに紐づく権限情報
type Session struct {
	BoardID   string    `json:"board_id"`
	Role      Role      `json:"role"`
	GuestID   string    `json:"guest_id"`
	CreatedAt time.Time `json:"created_at"`
}

// InviteToken は招待トークン
type InviteToken struct {
	BoardID   string    `json:"board_id"`
	Role      Role      `json:"role"`
	CreatedAt time.Time `json:"created_at"`
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

// generateToken はランダムなトークンを生成する
func generateToken(length int) string {
	bytes := make([]byte, length)
	rand.Read(bytes)
	return hex.EncodeToString(bytes)
}

// generatePassword は短い入力しやすいパスワードを生成する
func generatePassword() string {
	const chars = "abcdefghjkmnpqrstuvwxyz23456789"
	bytes := make([]byte, 8)
	rand.Read(bytes)
	result := make([]byte, 8)
	for i, b := range bytes {
		result[i] = chars[int(b)%len(chars)]
	}
	return string(result)
}

// getBoard はRedisからボードを取得する
func getBoard(boardId string) (*Board, error) {
	metaKey := fmt.Sprintf(boardMetaKey, boardId)
	boardData, err := rdb.Get(ctx, metaKey).Result()
	if err == redis.Nil {
		return nil, nil
	} else if err != nil {
		return nil, err
	}
	var board Board
	if err := json.Unmarshal([]byte(boardData), &board); err != nil {
		return nil, err
	}
	// 既存ボードのvisibilityデフォルト対応（マイグレーション）
	if board.Visibility == "" {
		board.Visibility = VisibilityPublic
	}
	return &board, nil
}

// resolveRole はボードとアクセストークンからロールを解決する
// パブリックボード：常にeditor
// プライベートボード：tokenからSessionを引いてroleを返す
// tokenが空かつパブリックなら editor を返す
func resolveRole(boardId, accessToken string, board *Board) (Role, bool) {
	if board.Visibility == VisibilityPublic {
		return RoleEditor, true
	}

	// プライベートボード
	if accessToken == "" {
		return "", false
	}

	// セッション検証
	sessKey := fmt.Sprintf(sessionKey, accessToken)
	sessData, err := rdb.Get(ctx, sessKey).Result()
	if err != nil {
		return "", false
	}
	var sess Session
	if err := json.Unmarshal([]byte(sessData), &sess); err != nil {
		return "", false
	}
	if sess.BoardID != boardId {
		return "", false
	}
	return sess.Role, true
}

// createSession はセッショントークンを発行してRedisに保存する
func createSession(boardId string, role Role, guestId string) (string, error) {
	token := generateToken(24)
	sess := Session{
		BoardID:   boardId,
		Role:      role,
		GuestID:   guestId,
		CreatedAt: time.Now(),
	}
	sessData, err := json.Marshal(sess)
	if err != nil {
		return "", err
	}
	key := fmt.Sprintf(sessionKey, token)
	// セッションは30日間有効
	if err := rdb.Set(ctx, key, string(sessData), 30*24*time.Hour).Err(); err != nil {
		return "", err
	}
	return token, nil
}

func handleConnections(w http.ResponseWriter, r *http.Request) {
	// boardIdをクエリパラメータから取得
	boardId := r.URL.Query().Get("boardId")
	if boardId == "" {
		boardId = "default"
	}
	accessToken := r.URL.Query().Get("accessToken")

	// ボード情報を取得
	board, err := getBoard(boardId)
	if err != nil {
		log.Printf("Failed to get board %s: %v", boardId, err)
		http.Error(w, "Internal Server Error", http.StatusInternalServerError)
		return
	}
	if board == nil {
		// ボードが存在しない場合はデフォルトとしてpublicで扱う（後方互換）
		board = &Board{ID: boardId, Visibility: VisibilityPublic}
	}

	// 権限チェック
	role, ok := resolveRole(boardId, accessToken, board)
	if !ok {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
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

	// 最初にrole情報を送信
	roleMsg, _ := json.Marshal(map[string]string{"type": "role", "role": string(role)})
	ws.WriteMessage(websocket.TextMessage, roleMsg)

	clientsMu.Lock()
	if boardClients[boardId] == nil {
		boardClients[boardId] = make(map[*websocket.Conn]bool)
	}
	boardClients[boardId][ws] = true
	clientsMu.Unlock()

	log.Printf("New client connected to board: %s (role: %s)", boardId, role)

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

		// 閲覧者は描画メッセージを送れない
		if role == RoleViewer {
			var data map[string]interface{}
			if err := json.Unmarshal(msg, &data); err == nil {
				msgType, _ := data["type"].(string)
				if msgType == "draw_step" || msgType == "text" || msgType == "clear" {
					// 閲覧者の描画操作は無視
					continue
				}
			}
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

// handleGetBoards はボード一覧を返す（パブリックのみ or ownerIdクエリ対応）
func handleGetBoards(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	// ownerIdクエリがあれば自分のプライベートボードも返す
	ownerID := strings.TrimSpace(r.URL.Query().Get("ownerId"))

	// 全ボードIDを取得
	boardIds, err := rdb.SMembers(ctx, allBoardsKey).Result()
	if err != nil {
		// 後方互換: allBoardsKeyがない場合はboardsIndexKeyを使う
		boardIds, err = rdb.SMembers(ctx, boardsIndexKey).Result()
		if err != nil {
			log.Printf("Failed to get board IDs: %v", err)
			http.Error(w, "Internal Server Error", http.StatusInternalServerError)
			return
		}
	}

	boards := []BoardPublic{}
	for _, boardId := range boardIds {
		board, err := getBoard(boardId)
		if err != nil || board == nil {
			continue
		}

		// 公開範囲フィルタリング
		if board.Visibility == VisibilityPrivate && board.OwnerID != ownerID {
			continue
		}

		boards = append(boards, BoardPublic{
			ID:         board.ID,
			Title:      board.Title,
			Visibility: board.Visibility,
			OwnerID:    board.OwnerID,
			CreatedAt:  board.CreatedAt,
			UpdatedAt:  board.UpdatedAt,
		})
	}

	json.NewEncoder(w).Encode(boards)
}

// handleBoardInfo はボードの公開情報を返す（パスワード除く）
func handleBoardInfo(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	boardId := r.URL.Query().Get("boardId")
	if boardId == "" {
		http.Error(w, "boardId is required", http.StatusBadRequest)
		return
	}

	board, err := getBoard(boardId)
	if err != nil {
		http.Error(w, "Internal Server Error", http.StatusInternalServerError)
		return
	}
	if board == nil {
		http.Error(w, "Board not found", http.StatusNotFound)
		return
	}

	json.NewEncoder(w).Encode(BoardPublic{
		ID:         board.ID,
		Title:      board.Title,
		Visibility: board.Visibility,
		OwnerID:    board.OwnerID,
		CreatedAt:  board.CreatedAt,
		UpdatedAt:  board.UpdatedAt,
	})
}

// handleCreateBoard は新しいボードを作成する
func handleCreateBoard(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req struct {
		Title      string     `json:"title"`
		Visibility Visibility `json:"visibility"`
		OwnerID    string     `json:"owner_id"`
	}

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		log.Printf("Failed to decode request: %v", err)
		http.Error(w, "Invalid request", http.StatusBadRequest)
		return
	}

	if req.Title == "" {
		req.Title = "Untitled Board"
	}
	if req.Visibility == "" {
		req.Visibility = VisibilityPublic
	}
	if req.OwnerID == "" {
		req.OwnerID = "anonymous"
	}

	boardId := uuid.New().String()
	board := Board{
		ID:         boardId,
		Title:      req.Title,
		Visibility: req.Visibility,
		OwnerID:    req.OwnerID,
		CreatedAt:  time.Now(),
		UpdatedAt:  time.Now(),
	}

	// プライベートボードはパスワードを自動生成
	if req.Visibility == VisibilityPrivate {
		board.EditPassword = generatePassword()
		board.ViewPassword = generatePassword()
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

	// 全ボードインデックスに追加
	rdb.SAdd(ctx, allBoardsKey, boardId)

	// パブリックボードはpublicインデックスにも追加（後方互換）
	if req.Visibility == VisibilityPublic {
		rdb.SAdd(ctx, boardsIndexKey, boardId)
	}

	// オーナー用セッションを発行（プライベートの場合も作成者はeditor）
	accessToken := ""
	if req.Visibility == VisibilityPrivate {
		token, err := createSession(boardId, RoleEditor, req.OwnerID)
		if err != nil {
			log.Printf("Failed to create owner session: %v", err)
		} else {
			accessToken = token
		}
	}

	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(map[string]interface{}{
		"board":        board,
		"access_token": accessToken,
	})
}

// handleJoinBoard はパスワードでボードに入室してセッショントークンを返す
func handleJoinBoard(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req struct {
		BoardID  string `json:"board_id"`
		Password string `json:"password"`
		GuestID  string `json:"guest_id"`
	}

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request", http.StatusBadRequest)
		return
	}

	board, err := getBoard(req.BoardID)
	if err != nil || board == nil {
		http.Error(w, "Board not found", http.StatusNotFound)
		return
	}

	if board.Visibility == VisibilityPublic {
		// パブリックボードは自動でeditor
		token, err := createSession(req.BoardID, RoleEditor, req.GuestID)
		if err != nil {
			http.Error(w, "Internal Server Error", http.StatusInternalServerError)
			return
		}
		json.NewEncoder(w).Encode(map[string]string{
			"access_token": token,
			"role":         string(RoleEditor),
		})
		return
	}

	// プライベートボード: パスワード検証
	var role Role
	if req.Password == board.EditPassword {
		role = RoleEditor
	} else if req.Password == board.ViewPassword {
		role = RoleViewer
	} else {
		http.Error(w, "Invalid password", http.StatusUnauthorized)
		return
	}

	token, err := createSession(req.BoardID, role, req.GuestID)
	if err != nil {
		http.Error(w, "Internal Server Error", http.StatusInternalServerError)
		return
	}

	json.NewEncoder(w).Encode(map[string]string{
		"access_token": token,
		"role":         string(role),
	})
}

// handleCreateInvite は招待トークンを生成する
func handleCreateInvite(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req struct {
		BoardID     string `json:"board_id"`
		Role        Role   `json:"role"`
		AccessToken string `json:"access_token"`
	}

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request", http.StatusBadRequest)
		return
	}

	// 呼び出し元がeditorであることを確認
	board, err := getBoard(req.BoardID)
	if err != nil || board == nil {
		http.Error(w, "Board not found", http.StatusNotFound)
		return
	}

	callerRole, ok := resolveRole(req.BoardID, req.AccessToken, board)
	if !ok || callerRole != RoleEditor {
		http.Error(w, "Forbidden: only editors can create invite links", http.StatusForbidden)
		return
	}

	if req.Role != RoleEditor && req.Role != RoleViewer {
		req.Role = RoleViewer
	}

	token := generateToken(20)
	invite := InviteToken{
		BoardID:   req.BoardID,
		Role:      req.Role,
		CreatedAt: time.Now(),
	}
	inviteData, _ := json.Marshal(invite)
	key := fmt.Sprintf(inviteTokenKey, token)
	// 招待リンクは永続（削除するまで有効）
	rdb.Set(ctx, key, string(inviteData), 0)

	json.NewEncoder(w).Encode(map[string]string{
		"invite_token": token,
	})
}

// handleUseInvite は招待トークンを使ってセッションを発行する
func handleUseInvite(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req struct {
		InviteToken string `json:"invite_token"`
		GuestID     string `json:"guest_id"`
	}

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request", http.StatusBadRequest)
		return
	}

	key := fmt.Sprintf(inviteTokenKey, req.InviteToken)
	inviteData, err := rdb.Get(ctx, key).Result()
	if err == redis.Nil {
		http.Error(w, "Invalid or expired invite token", http.StatusNotFound)
		return
	} else if err != nil {
		http.Error(w, "Internal Server Error", http.StatusInternalServerError)
		return
	}

	var invite InviteToken
	if err := json.Unmarshal([]byte(inviteData), &invite); err != nil {
		http.Error(w, "Internal Server Error", http.StatusInternalServerError)
		return
	}

	// ボード情報を取得
	board, err := getBoard(invite.BoardID)
	if err != nil || board == nil {
		http.Error(w, "Board not found", http.StatusNotFound)
		return
	}

	// セッション発行
	token, err := createSession(invite.BoardID, invite.Role, req.GuestID)
	if err != nil {
		http.Error(w, "Internal Server Error", http.StatusInternalServerError)
		return
	}

	json.NewEncoder(w).Encode(map[string]interface{}{
		"access_token": token,
		"role":         string(invite.Role),
		"board": BoardPublic{
			ID:         board.ID,
			Title:      board.Title,
			Visibility: board.Visibility,
			OwnerID:    board.OwnerID,
			CreatedAt:  board.CreatedAt,
			UpdatedAt:  board.UpdatedAt,
		},
	})
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
	rdb.SRem(ctx, allBoardsKey, req.BoardId)

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
