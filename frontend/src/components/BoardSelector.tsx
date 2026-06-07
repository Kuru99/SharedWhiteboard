import React, { useState, useEffect } from 'react';
import '../styles/BoardSelector.css';

interface Board {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
}

interface BoardSelectorProps {
  selectedBoardId: string;
  onBoardSelect: (boardId: string) => void;
}

const BoardSelector: React.FC<BoardSelectorProps> = ({
  selectedBoardId,
  onBoardSelect,
}) => {
  const [boards, setBoards] = useState<Board[]>([]);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newBoardTitle, setNewBoardTitle] = useState('');
  const [loading, setLoading] = useState(false);

  // ボード一覧を取得
  useEffect(() => {
    fetchBoards();
  }, []);

  const getApiHost = () => {
    const envHost = import.meta.env.VITE_API_BASE_URL;
    if (envHost && envHost !== '') {
      return envHost;
    }
    const protocol = window.location.protocol === 'https:' ? 'https:' : 'http:';
    return `${protocol}//${window.location.hostname}:8000`;
  };

  const fetchBoards = async () => {
    try {
      const apiHost = getApiHost();
      const response = await fetch(`${apiHost}/api/boards`);
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
        body: JSON.stringify({ title: newBoardTitle }),
      });

      if (response.ok) {
        const newBoard = await response.json();
        setBoards([...boards, newBoard]);
        setNewBoardTitle('');
        setShowCreateForm(false);
        onBoardSelect(newBoard.id);
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
    if (!confirm('このボードを削除してもよろしいですか？')) {
      return;
    }

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
            onBoardSelect(nextBoard.id);
          }
        }
      } else {
        const errorText = await response.text();
        console.error('Delete board failed:', response.status, errorText);
        alert(`ボード削除に失敗しました (${response.status}: ${errorText})`);
      }
    } catch (error) {
      console.error('Failed to delete board:', error);
      alert('ボード削除に失敗しました');
    }
  };

  return (
    <div className="board-selector">
      <div className="board-selector-header">
        <h2>ホワイトボード</h2>
        <button
          className="btn-new-board"
          onClick={() => setShowCreateForm(!showCreateForm)}
        >
          ＋ 新規作成
        </button>
      </div>

      {showCreateForm && (
        <div className="create-board-form">
          <input
            type="text"
            placeholder="ボード名を入力..."
            value={newBoardTitle}
            onChange={(e) => setNewBoardTitle(e.target.value)}
            onKeyPress={(e) => e.key === 'Enter' && handleCreateBoard()}
          />
          <button onClick={handleCreateBoard} disabled={loading}>
            {loading ? '作成中...' : '作成'}
          </button>
          <button onClick={() => setShowCreateForm(false)}>キャンセル</button>
        </div>
      )}

      <div className="board-list">
        {boards.length === 0 ? (
          <p className="no-boards">ボードがありません</p>
        ) : (
          boards.map((board) => (
            <div
              key={board.id}
              className={`board-item ${
                selectedBoardId === board.id ? 'active' : ''
              }`}
              onClick={() => onBoardSelect(board.id)}
            >
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
