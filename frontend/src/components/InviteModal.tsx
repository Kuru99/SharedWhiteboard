import React, { useState } from 'react';

interface InviteModalProps {
  boardId: string;
  accessToken: string;
  onClose: () => void;
}

const getApiHost = () => {
  const envHost = import.meta.env.VITE_API_BASE_URL;
  if (envHost && envHost !== '') return envHost;
  const protocol = window.location.protocol === 'https:' ? 'https:' : 'http:';
  return `${protocol}//${window.location.hostname}:8000`;
};

const InviteModal: React.FC<InviteModalProps> = ({ boardId, accessToken, onClose }) => {
  const [editorLink, setEditorLink] = useState('');
  const [viewerLink, setViewerLink] = useState('');
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  const generateInvite = async (role: 'editor' | 'viewer') => {
    setLoading(true);
    try {
      const apiHost = getApiHost();
      const res = await fetch(`${apiHost}/api/boards/invite/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          board_id: boardId,
          role,
          access_token: accessToken,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        const url = `${window.location.origin}${window.location.pathname}?invite=${data.invite_token}`;
        if (role === 'editor') setEditorLink(url);
        else setViewerLink(url);
      } else {
        alert('招待リンクの生成に失敗しました。');
      }
    } catch (e) {
      alert('通信エラーが発生しました。');
    } finally {
      setLoading(false);
    }
  };

  const copyLink = (text: string, key: string) => {
    navigator.clipboard.writeText(text).catch(() => {
      const el = document.createElement('textarea');
      el.value = text;
      document.body.appendChild(el);
      el.select();
      document.execCommand('copy');
      document.body.removeChild(el);
    });
    setCopied(key);
    setTimeout(() => setCopied(null), 2000);
  };

  return (
    <div className="invite-overlay" onClick={onClose}>
      <div className="invite-modal" onClick={(e) => e.stopPropagation()}>
        <div className="invite-header">
          <span className="invite-icon">🔗</span>
          <h2>招待リンクを共有</h2>
          <button className="invite-close-x" onClick={onClose}>✕</button>
        </div>
        <p className="invite-desc">
          招待リンクを生成して相手に送ることで、プライベートボードに参加させることができます。
        </p>

        {/* 編集者招待 */}
        <div className="invite-section">
          <div className="invite-role-header editor">
            <span>✏️ 編集者招待</span>
            <small>描画・編集ができます</small>
          </div>
          {editorLink ? (
            <div className="invite-link-row">
              <input type="text" readOnly value={editorLink} className="invite-link-input" />
              <button
                className={`copy-link-btn ${copied === 'editor' ? 'copied' : ''}`}
                onClick={() => copyLink(editorLink, 'editor')}
              >
                {copied === 'editor' ? '✓ コピー済み' : 'コピー'}
              </button>
            </div>
          ) : (
            <button
              className="generate-btn editor-btn"
              onClick={() => generateInvite('editor')}
              disabled={loading}
            >
              ✏️ 編集者用リンクを生成
            </button>
          )}
        </div>

        {/* 閲覧者招待 */}
        <div className="invite-section">
          <div className="invite-role-header viewer">
            <span>👁 閲覧者招待</span>
            <small>閲覧のみ（描画不可）</small>
          </div>
          {viewerLink ? (
            <div className="invite-link-row">
              <input type="text" readOnly value={viewerLink} className="invite-link-input" />
              <button
                className={`copy-link-btn ${copied === 'viewer' ? 'copied' : ''}`}
                onClick={() => copyLink(viewerLink, 'viewer')}
              >
                {copied === 'viewer' ? '✓ コピー済み' : 'コピー'}
              </button>
            </div>
          ) : (
            <button
              className="generate-btn viewer-btn"
              onClick={() => generateInvite('viewer')}
              disabled={loading}
            >
              👁 閲覧者用リンクを生成
            </button>
          )}
        </div>

        <p className="invite-note">
          ⚠️ リンクを知っている人は誰でも参加できます。信頼できる相手にのみ共有してください。
        </p>

        <button className="invite-done-btn" onClick={onClose}>閉じる</button>
      </div>

      <style>{`
        .invite-overlay {
          position: fixed;
          inset: 0;
          background: rgba(0,0,0,0.55);
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
        .invite-modal {
          background: #fff;
          border-radius: 16px;
          padding: 2rem;
          width: 100%;
          max-width: 500px;
          box-shadow: 0 24px 60px rgba(0,0,0,0.18);
          animation: slideUp 0.25s cubic-bezier(0.34,1.56,0.64,1);
        }
        @keyframes slideUp {
          from { transform: translateY(20px); opacity: 0; }
          to { transform: translateY(0); opacity: 1; }
        }
        .invite-header {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          margin-bottom: 0.75rem;
        }
        .invite-icon {
          font-size: 1.8rem;
        }
        .invite-header h2 {
          flex: 1;
          margin: 0;
          font-size: 1.25rem;
          color: #1e293b;
          font-weight: 700;
        }
        .invite-close-x {
          background: none;
          border: none;
          font-size: 1.1rem;
          cursor: pointer;
          color: #94a3b8;
          padding: 4px 8px;
          border-radius: 6px;
          transition: color 0.2s, background 0.2s;
        }
        .invite-close-x:hover {
          background: #f1f5f9;
          color: #475569;
        }
        .invite-desc {
          color: #64748b;
          font-size: 0.88rem;
          margin-bottom: 1.5rem;
          line-height: 1.6;
        }
        .invite-section {
          background: #f8fafc;
          border: 1px solid #e2e8f0;
          border-radius: 12px;
          padding: 1rem;
          margin-bottom: 1rem;
        }
        .invite-role-header {
          display: flex;
          align-items: baseline;
          gap: 0.5rem;
          margin-bottom: 0.75rem;
        }
        .invite-role-header span {
          font-weight: 700;
          font-size: 0.95rem;
          color: #1e293b;
        }
        .invite-role-header small {
          color: #94a3b8;
          font-size: 0.78rem;
        }
        .invite-link-row {
          display: flex;
          gap: 0.5rem;
        }
        .invite-link-input {
          flex: 1;
          padding: 0.5rem 0.75rem;
          border: 1px solid #e2e8f0;
          border-radius: 8px;
          font-size: 0.78rem;
          color: #475569;
          background: #fff;
          font-family: monospace;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .copy-link-btn {
          white-space: nowrap;
          padding: 0.5rem 1rem;
          border: none;
          border-radius: 8px;
          font-size: 0.85rem;
          font-weight: 600;
          cursor: pointer;
          background: #2563eb;
          color: white;
          transition: all 0.2s;
        }
        .copy-link-btn:hover {
          background: #1d4ed8;
        }
        .copy-link-btn.copied {
          background: #22c55e;
        }
        .generate-btn {
          width: 100%;
          padding: 0.65rem 1rem;
          border: 2px dashed #cbd5e1;
          border-radius: 8px;
          background: transparent;
          font-size: 0.9rem;
          font-weight: 600;
          cursor: pointer;
          color: #475569;
          transition: all 0.2s;
        }
        .generate-btn:hover {
          border-color: #2563eb;
          color: #2563eb;
          background: #eff6ff;
        }
        .generate-btn:disabled {
          opacity: 0.6;
          cursor: not-allowed;
        }
        .editor-btn:hover {
          border-color: #2563eb;
          color: #2563eb;
          background: #eff6ff;
        }
        .viewer-btn:hover {
          border-color: #7c3aed;
          color: #7c3aed;
          background: #f5f3ff;
        }
        .invite-note {
          font-size: 0.78rem;
          color: #94a3b8;
          margin-bottom: 1.25rem;
          background: #fef9c3;
          padding: 0.6rem 0.8rem;
          border-radius: 8px;
          border: 1px solid #fde68a;
          color: #92400e;
        }
        .invite-done-btn {
          width: 100%;
          padding: 0.75rem;
          background: #f1f5f9;
          color: #475569;
          border: 1px solid #e2e8f0;
          border-radius: 10px;
          font-size: 1rem;
          font-weight: 600;
          cursor: pointer;
          transition: background 0.2s;
        }
        .invite-done-btn:hover {
          background: #e2e8f0;
        }
      `}</style>
    </div>
  );
};

export default InviteModal;
