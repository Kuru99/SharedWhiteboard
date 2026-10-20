package main

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"sync"

	"github.com/gorilla/websocket"
)

var (
	// WebSocketの設定
	upgrader = websocket.Upgrader{
		CheckOrigin: func(r *http.Request) bool {
			return true // 開発用：全てのドメインからの接続を許可
		},
	}

	// 接続されているクライアントを管理（ボードID -> クライアント接続）
	boardClients = make(map[string]map[*websocket.Conn]bool)
	clientsMu    sync.Mutex
)

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
