import React, { useState, useEffect } from 'react';
import '../styles/BoardSelector.css';

interface Board {
  id: string;
  title: string;
  visibility: 'public' | 'private';
  owner_id: string;
  created_at: string;
  updated_at: string;
}

interface BoardSelectorProps {
  selectedBoardId: string;
  guestId: string;
  onBoardSelect: (boardId: string, visibility?: string) => void;
  onAccessTokenSet: (boardId: string, token: string) => void;
  onRoleUpdate: (role: 'editor' | 'viewer') => void;
}

const BoardSelector: React.FC<BoardSelectorProps> = ({
  selectedBoardId,
  guestId,
  onBoardSelect,
  onAccessTokenSet,
  onRoleUpdate,
}) => {
  const [boards, setBoards] = useState<Board[]>([]);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newBoardTitle, setNewBoardTitle] = useState('');
  const [newBoardVisibility, setNewBoardVisibility] = useState<'public' | 'private'>('public');
  const [loading, setLoading] = useState(false);
  // 作成直後のパスワード表示
  const [createdBoardInfo, setCreatedBoardInfo] = useState<{
    title: string;
    edit_password: string;
    view_password: string;
    board_id: string;
  } | null>(null);

  useEffect(() => {
    fetchBoards();
  }, []);

  const getApiHost = () => {
    const envHost = import.meta.env.VITE_API_BASE_URL;
    if (envHost && envHost !== '') return envHost;
    const protocol = window.location.protocol === 'https:' ? 'https:' : 'http:';
    return `${protocol}//${window.location.hostname}:8000`;
  };

  const fetchBoards = async () => {
    try {
      const apiHost = getApiHost();
      // 自分のプライベートボードも取得するためownerIdを付与
      const response = await fetch(`${apiHost}/api/boards?ownerId=${encodeURIComponent(guestId)}`);
      const data = await response.json();
      setBoards(data || []);
    } catch (error) {
      console.error('Failed to fetch boards:', error);
    }
  };

  const handleCreateBoard = async () => {
    if (!newBoardTitle.trim()) {
      alert('ボード名を入力してください');
      return;
    }

    setLoading(true);
    try {
      const apiHost = getApiHost();
      const response = await fetch(`${apiHost}/api/boards/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: newBoardTitle,
          visibility: newBoardVisibility,
          owner_id: guestId,
        }),
      });

      if (response.ok) {
        const data = await response.json();
        const newBoard: Board = {
          ...data.board,
          visibility: data.board.visibility || 'public',
        };
        setBoards([...boards, newBoard]);
        setNewBoardTitle('');
        setShowCreateForm(false);

        if (data.board.visibility === 'private') {
          // プライベートの場合はパスワードを表示してアクセストークンを保存
          if (data.access_token) {
            onAccessTokenSet(data.board.id, data.access_token);
            onRoleUpdate('editor');
          }
          setCreatedBoardInfo({
            title: data.board.title,
            edit_password: data.board.edit_password,
            view_password: data.board.view_password,
            board_id: data.board.id,
          });
        } else {
          onBoardSelect(newBoard.id, newBoard.visibility);
        }
      } else {
        const errorText = await response.text();
        console.error('Create board failed:', response.status, errorText);
        alert(`ボード作成に失敗しました (${response.status}: ${errorText})`);
      }
    } catch (error) {
      console.error('Failed to create board:', error);
      alert('ボード作成に失敗しました');
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteBoard = async (boardId: string) => {
    if (!confirm('このボードを削除してもよろしいですか？')) return;

    try {
      const apiHost = getApiHost();
      const response = await fetch(`${apiHost}/api/boards/delete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ boardId }),
      });

      if (response.ok) {
        setBoards(boards.filter((b) => b.id !== boardId));
        if (selectedBoardId === boardId && boards.length > 1) {
          const nextBoard = boards.find((b) => b.id !== boardId);
          if (nextBoard) {
            onBoardSelect(nextBoard.id, nextBoard.visibility);
          }
        }
      } else {
        const errorText = await response.text();
        alert(`ボード削除に失敗しました (${response.status}: ${errorText})`);
      }
    } catch (error) {
      console.error('Failed to delete board:', error);
      alert('ボード削除に失敗しました');
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text).then(() => {
      alert('コピーしました！');
    }).catch(() => {
      // フォールバック
      const el = document.createElement('textarea');
      el.value = text;
      document.body.appendChild(el);
      el.select();
      document.execCommand('copy');
      document.body.removeChild(el);
      alert('コピーしました！');
    });
  };

  return (
    <div className="board-selector">
      <div className="board-selector-header">
        <h2>ホワイトボード</h2>
        <button
          className="btn-new-board"
          onClick={() => { setShowCreateForm(!showCreateForm); setCreatedBoardInfo(null); }}
        >
          ＋ 新規作成
        </button>
      </div>

      {/* 作成完了後のパスワード表示 */}
      {createdBoardInfo && (
        <div className="password-reveal">
          <p className="password-reveal-title">🔒 プライベートボードを作成しました</p>
          <p className="password-reveal-subtitle">このパスワードは今後ここには表示されません。必ず控えてください。</p>
          <div className="password-item">
            <span className="password-label">✏️ 編集用パスワード</span>
            <code className="password-value">{createdBoardInfo.edit_password}</code>
            <button className="copy-btn" onClick={() => copyToClipboard(createdBoardInfo.edit_password)}>コピー</button>
          </div>
          <div className="password-item">
            <span className="password-label">👁 閲覧用パスワード</span>
            <code className="password-value">{createdBoardInfo.view_password}</code>
            <button className="copy-btn" onClick={() => copyToClipboard(createdBoardInfo.view_password)}>コピー</button>
          </div>
          <button
            className="btn-go-board"
            onClick={() => {
              onBoardSelect(createdBoardInfo.board_id, 'private');
              setCreatedBoardInfo(null);
            }}
          >
            ボードを開く →
          </button>
        </div>
      )}

      {showCreateForm && (
        <div className="create-board-form">
          <input
            type="text"
            placeholder="ボード名を入力..."
            value={newBoardTitle}
            onChange={(e) => setNewBoardTitle(e.target.value)}
            onKeyPress={(e) => e.key === 'Enter' && handleCreateBoard()}
          />
          <div className="visibility-toggle">
            <button
              className={`vis-btn ${newBoardVisibility === 'public' ? 'active' : ''}`}
              onClick={() => setNewBoardVisibility('public')}
              type="button"
            >
              🌐 パブリック
            </button>
            <button
              className={`vis-btn ${newBoardVisibility === 'private' ? 'active' : ''}`}
              onClick={() => setNewBoardVisibility('private')}
              type="button"
            >
              🔒 プライベート
            </button>
          </div>
          {newBoardVisibility === 'private' && (
            <p className="private-note">
              パスワードが自動生成されます。作成後に表示されます。
            </p>
          )}
          <div className="form-actions">
            <button onClick={handleCreateBoard} disabled={loading}>
              {loading ? '作成中...' : '作成'}
            </button>
            <button onClick={() => setShowCreateForm(false)}>キャンセル</button>
          </div>
        </div>
      )}

      <div className="board-list">
        {boards.length === 0 ? (
          <p className="no-boards">ボードがありません</p>
        ) : (
          boards.map((board) => (
            <div
              key={board.id}
              className={`board-item ${selectedBoardId === board.id ? 'active' : ''}`}
              onClick={() => onBoardSelect(board.id, board.visibility)}
            >
              <span className="board-visibility-icon">
                {board.visibility === 'private' ? '🔒' : '🌐'}
              </span>
              <span className="board-title">{board.title}</span>
              <button
                className="btn-delete"
                onClick={(e) => {
                  e.stopPropagation();
                  handleDeleteBoard(board.id);
                }}
                title="削除"
              >
                ✕
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
};

export default BoardSelector;
