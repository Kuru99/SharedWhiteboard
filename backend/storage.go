package main

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"time"

	"github.com/go-redis/redis/v8"
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

// hashOwnerToken は作成者トークンのハッシュを計算する
func hashOwnerToken(token string) string {
	sum := sha256.Sum256([]byte(token))
	return hex.EncodeToString(sum[:])
}

// saveOwnerToken は作成者トークンのハッシュを保存する
func saveOwnerToken(boardId, token string) error {
	key := fmt.Sprintf(ownerTokenKey, boardId)
	return rdb.Set(ctx, key, hashOwnerToken(token), 0).Err()
}

// verifyOwnerToken は作成者トークンを検証する
func verifyOwnerToken(boardId, token string) bool {
	if token == "" {
		return false
	}

	key := fmt.Sprintf(ownerTokenKey, boardId)
	storedHash, err := rdb.Get(ctx, key).Result()
	if err != nil {
		return false
	}

	return storedHash == hashOwnerToken(token)
}
