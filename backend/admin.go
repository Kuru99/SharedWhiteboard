package main

import (
	"crypto/subtle"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
)

// handleAdminDeleteBoard は管理者専用のボード削除処理。
func handleAdminDeleteBoard(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	// サーバーに管理者トークンが設定されていることを確認する。
	configuredToken := os.Getenv("ADMIN_DELETE_TOKEN")
	providedToken := r.Header.Get("X-Admin-Token")

	if configuredToken == "" || providedToken == "" ||
		subtle.ConstantTimeCompare(
			[]byte(providedToken),
			[]byte(configuredToken),
		) != 1 {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
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
