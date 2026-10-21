package main

import (
	"crypto/subtle"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
)

// authorizeAdminRequest は管理者トークンを検証する。
func authorizeAdminRequest(w http.ResponseWriter, r *http.Request) bool {
	configuredToken := os.Getenv("ADMIN_DELETE_TOKEN")
	providedToken := r.Header.Get("X-Admin-Token")

	if configuredToken == "" || providedToken == "" ||
		subtle.ConstantTimeCompare(
			[]byte(providedToken),
			[]byte(configuredToken),
		) != 1 {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return false
	}

	return true
}

// handleAdminDeleteBoard は管理者専用のボード削除処理。
func handleAdminDeleteBoard(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if !authorizeAdminRequest(w, r) {
		return
	}

	// リクエストから削除対象のボードIDを取得する。
	var req struct {
		BoardID string `json:"boardId"`
	}

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request", http.StatusBadRequest)
		return
	}

	if req.BoardID == "" {
		http.Error(w, "Board ID is required", http.StatusBadRequest)
		return
	}

	// 対象のボードが存在するか確認する。
	board, err := getBoard(req.BoardID)
	if err != nil {
		log.Printf("Admin delete: failed to get board: %v", err)
		http.Error(w, "Internal Server Error", http.StatusInternalServerError)
		return
	}

	if board == nil {
		http.Error(w, "Board not found", http.StatusNotFound)
		return
	}

	// ボード本体・描画データ・所有者トークンを削除する。
	metaKey := fmt.Sprintf(boardMetaKey, req.BoardID)
	stateKey := fmt.Sprintf(boardStateKey, req.BoardID)
	ownerKey := fmt.Sprintf(ownerTokenKey, req.BoardID)

	if err := rdb.Del(ctx, metaKey, stateKey, ownerKey).Err(); err != nil {
		log.Printf("Admin delete: failed to delete board data: %v", err)
		http.Error(w, "Internal Server Error", http.StatusInternalServerError)
		return
	}

	// 公開ボード一覧から削除する。
	if err := rdb.SRem(ctx, boardsIndexKey, req.BoardID).Err(); err != nil {
		log.Printf("Admin delete: failed to remove public index: %v", err)
		http.Error(w, "Internal Server Error", http.StatusInternalServerError)
		return
	}

	// 全ボード一覧から削除する。
	if err := rdb.SRem(ctx, allBoardsKey, req.BoardID).Err(); err != nil {
		log.Printf("Admin delete: failed to remove all-boards index: %v", err)
		http.Error(w, "Internal Server Error", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_ = json.NewEncoder(w).Encode(map[string]string{
		"status": "deleted",
	})
}

// handleAdminListBoards は管理者専用の全ボード一覧を返す。
func handleAdminListBoards(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	if !authorizeAdminRequest(w, r) {
		return
	}

	// 一覧をキャッシュさせない。
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")

	// 公開・非公開を含む全ボードIDを取得する。
	boardIDs, err := rdb.SMembers(ctx, allBoardsKey).Result()
	if err != nil {
		log.Printf("Admin list: failed to get board IDs: %v", err)
		http.Error(w, "Failed to get board list", http.StatusInternalServerError)
		return
	}

	// 管理画面に返す項目を限定する。
	type adminBoardItem struct {
		ID         string      `json:"id"`
		Title      string      `json:"title"`
		Visibility Visibility  `json:"visibility"`
		CreatedAt  interface{} `json:"createdAt"`
	}

	boards := make([]adminBoardItem, 0, len(boardIDs))

	for _, boardID := range boardIDs {
		board, err := getBoard(boardID)
		if err != nil {
			log.Printf("Admin list: failed to get board %s: %v", boardID, err)
			http.Error(w, "Failed to get board details", http.StatusInternalServerError)
			return
		}

		// インデックスに残っている削除済みボードは一覧に含めない。
		if board == nil {
			continue
		}

		boards = append(boards, adminBoardItem{
			ID:         board.ID,
			Title:      board.Title,
			Visibility: board.Visibility,
			CreatedAt:  board.CreatedAt,
		})
	}

	if err := json.NewEncoder(w).Encode(boards); err != nil {
		log.Printf("Admin list: failed to encode response: %v", err)
	}
}
