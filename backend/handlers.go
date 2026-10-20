package main

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"strings"
	"time"

	"github.com/go-redis/redis/v8"
	"github.com/google/uuid"
)

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
