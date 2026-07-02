import React, { useState } from 'react';

interface JoinBoardModalProps {
  board: { id: string; title: string; visibility: string };
  guestId: string;
  onSuccess: (boardId: string, token: string, role: 'editor' | 'viewer') => void;
  onClose: () => void;
}

const getApiHost = () => {
  const envHost = import.meta.env.VITE_API_BASE_URL;
  if (envHost && envHost !== '') return envHost;
  const protocol = window.location.protocol === 'https:' ? 'https:' : 'http:';
  return `${protocol}//${window.location.hostname}:8000`;
};

const JoinBoardModal: React.FC<JoinBoardModalProps> = ({ board, guestId, onSuccess, onClose }) => {
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleJoin = async () => {
    if (!password.trim()) {
      setError('パスワードを入力してください');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const apiHost = getApiHost();
      const res = await fetch(`${apiHost}/api/boards/join`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          board_id: board.id,
          password: password.trim(),
          guest_id: guestId,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        onSuccess(board.id, data.access_token, data.role);
      } else if (res.status === 401) {
        setError('パスワードが違います。');
      } else {
        setError('入室に失敗しました。もう一度お試しください。');
      }
    } catch (e) {
      setError('通信エラーが発生しました。');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content join-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <span className="modal-icon">🔒</span>
          <h2>プライベートボードに入室</h2>
        </div>
        <p className="modal-board-name">「{board.title}」</p>
        <p className="modal-desc">
          このボードはプライベートです。
          <br />
          共有されたパスワードを入力してください。
        </p>

        <div className="join-form">
          <label htmlFor="board-password">パスワード</label>
          <input
            id="board-password"
            type="text"
            placeholder="パスワードを入力..."
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleJoin()}
            autoFocus
          />
          {error && <p className="join-error">{error}</p>}
        </div>

        <div className="password-hint">
          <span>💡 ヒント</span>
          <ul>
            <li>編集用パスワード → 描画・編集ができます</li>
            <li>閲覧用パスワード → 見るだけ（描画不可）</li>
          </ul>
        </div>

        <div className="modal-actions">
          <button
            className="btn-join"
            onClick={handleJoin}
            disabled={loading}
          >
            {loading ? '確認中...' : '入室する'}
          </button>
          <button className="btn-cancel" onClick={onClose}>
            キャンセル
          </button>
        </div>
      </div>

      <style>{`
        .modal-overlay {
          position: fixed;
          inset: 0;
          background: rgba(0, 0, 0, 0.55);
          backdrop-filter: blur(4px);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 5000;
          padding: 1rem;
          animation: fadeIn 0.2s ease;
        }
        @keyframes fadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        .modal-content {
          background: #fff;
          border-radius: 16px;
          padding: 2rem;
          width: 100%;
          max-width: 420px;
          box-shadow: 0 24px 60px rgba(0,0,0,0.18);
          animation: slideUp 0.25s cubic-bezier(0.34,1.56,0.64,1);
        }
        @keyframes slideUp {
          from { transform: translateY(20px); opacity: 0; }
          to { transform: translateY(0); opacity: 1; }
        }
        .modal-header {
          display: flex;
          align-items: center;
          gap: 0.6rem;
          margin-bottom: 0.5rem;
        }
        .modal-icon {
          font-size: 1.8rem;
        }
        .modal-header h2 {
          margin: 0;
          font-size: 1.3rem;
          color: #1e293b;
          font-weight: 700;
        }
        .modal-board-name {
          font-size: 1.05rem;
          font-weight: 600;
          color: #2563eb;
          margin: 0 0 0.5rem 0;
        }
        .modal-desc {
          color: #64748b;
          font-size: 0.9rem;
          margin-bottom: 1.5rem;
          line-height: 1.6;
        }
        .join-form {
          margin-bottom: 1rem;
        }
        .join-form label {
          display: block;
          font-size: 0.85rem;
          font-weight: 600;
          color: #475569;
          margin-bottom: 0.4rem;
        }
        .join-form input {
          width: 100%;
          padding: 0.7rem 1rem;
          border: 2px solid #e2e8f0;
          border-radius: 10px;
          font-size: 1rem;
          outline: none;
          transition: border-color 0.2s;
          box-sizing: border-box;
          font-family: monospace;
          letter-spacing: 0.1em;
        }
        .join-form input:focus {
          border-color: #2563eb;
        }
        .join-error {
          color: #ef4444;
          font-size: 0.85rem;
          margin-top: 0.4rem;
          font-weight: 500;
        }
        .password-hint {
          background: #f8fafc;
          border: 1px solid #e2e8f0;
          border-radius: 8px;
          padding: 0.75rem 1rem;
          margin-bottom: 1.5rem;
          font-size: 0.82rem;
          color: #475569;
        }
        .password-hint span {
          font-weight: 600;
          display: block;
          margin-bottom: 0.3rem;
          color: #334155;
        }
        .password-hint ul {
          margin: 0;
          padding-left: 1.2rem;
          line-height: 1.7;
        }
        .modal-actions {
          display: flex;
          gap: 0.75rem;
        }
        .btn-join {
          flex: 1;
          background: linear-gradient(135deg, #2563eb, #3b82f6);
          color: white;
          border: none;
          border-radius: 10px;
          padding: 0.75rem 1.5rem;
          font-size: 1rem;
          font-weight: 700;
          cursor: pointer;
          transition: all 0.2s;
          box-shadow: 0 4px 12px rgba(37,99,235,0.3);
        }
        .btn-join:hover {
          transform: translateY(-1px);
          box-shadow: 0 6px 16px rgba(37,99,235,0.4);
        }
        .btn-join:disabled {
          opacity: 0.7;
          cursor: not-allowed;
          transform: none;
        }
        .btn-cancel {
          background: #f1f5f9;
          color: #475569;
          border: 1px solid #e2e8f0;
          border-radius: 10px;
          padding: 0.75rem 1.2rem;
          font-size: 1rem;
          cursor: pointer;
          transition: background 0.2s;
        }
        .btn-cancel:hover {
          background: #e2e8f0;
        }
      `}</style>
    </div>
  );
};

export default JoinBoardModal;
