import { useState, useEffect, useCallback } from 'react'
import Whiteboard from './components/Whiteboard'
import BoardSelector from './components/BoardSelector'
import JoinBoardModal from './components/JoinBoardModal'
import InviteModal from './components/InviteModal'
import './App.css'

// ゲストIDをlocalStorageで管理
function getOrCreateGuestId(): string {
  const key = 'sharedwhiteboard_guest_id'
  let id = localStorage.getItem(key)
  if (!id) {
    id = `guest-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
    localStorage.setItem(key, id)
  }
  return id
}

// アクセストークン管理（ボードIDごと）
function getAccessToken(boardId: string): string {
  return sessionStorage.getItem(`board_token_${boardId}`) || ''
}
function setAccessToken(boardId: string, token: string) {
  sessionStorage.setItem(`board_token_${boardId}`, token)
}

const guestId = getOrCreateGuestId()

const getApiHost = () => {
  const envHost = import.meta.env.VITE_API_BASE_URL
  if (envHost && envHost !== '') return envHost
  const protocol = window.location.protocol === 'https:' ? 'https:' : 'http:'
  return `${protocol}//${window.location.hostname}:8000`
}

function App() {
  const [selectedBoardId, setSelectedBoardId] = useState(() => {
    let isReload = false
    if (window.performance) {
      const navEntries = window.performance.getEntriesByType('navigation') as PerformanceNavigationTiming[]
      if (navEntries.length > 0) {
        isReload = navEntries[0].type === 'reload'
      } else if (window.performance.navigation) {
        isReload = window.performance.navigation.type === 1
      }
    }
    if (isReload) {
      return sessionStorage.getItem('sharedwhiteboard_session_board') || ''
    } else {
      sessionStorage.removeItem('sharedwhiteboard_session_board')
      return ''
    }
  })
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [tutorialOpen, setTutorialOpen] = useState(false)

  // 招待URLの処理
  const [pendingInviteToken, setPendingInviteToken] = useState<string | null>(null)
  const [joinModalBoard, setJoinModalBoard] = useState<{ id: string; title: string; visibility: string } | null>(null)
  const [inviteModalBoardId, setInviteModalBoardId] = useState<string | null>(null)

  // 現在のボードのロール
  const [currentRole, setCurrentRole] = useState<'editor' | 'viewer' | null>(null)

  useEffect(() => {
    if (selectedBoardId) {
      sessionStorage.setItem('sharedwhiteboard_session_board', selectedBoardId)
    } else {
      sessionStorage.removeItem('sharedwhiteboard_session_board')
    }
  }, [selectedBoardId])

  // URL の ?invite=TOKEN を処理
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const invite = params.get('invite')
    if (invite) {
      setPendingInviteToken(invite)
      // URLからパラメータを除去
      const newUrl = window.location.pathname
      window.history.replaceState({}, '', newUrl)
    }
  }, [])

  // 招待トークンを自動処理
  useEffect(() => {
    if (!pendingInviteToken) return
    ;(async () => {
      try {
        const apiHost = getApiHost()
        const res = await fetch(`${apiHost}/api/boards/invite/use`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ invite_token: pendingInviteToken, guest_id: guestId }),
        })
        if (res.ok) {
          const data = await res.json()
          setAccessToken(data.board.id, data.access_token)
          setCurrentRole(data.role)
          setSelectedBoardId(data.board.id)
          alert(`「${data.board.title}」に${data.role === 'editor' ? '編集者' : '閲覧者'}として参加しました！`)
        } else {
          alert('招待リンクが無効または期限切れです。')
        }
      } catch (e) {
        console.error('Invite use error:', e)
      } finally {
        setPendingInviteToken(null)
      }
    })()
  }, [pendingInviteToken])

  const handleBoardSelect = useCallback(async (boardId: string, visibility?: string) => {
    // プライベートボードかつトークンなし → 入室モーダルを表示
    if (visibility === 'private' && !getAccessToken(boardId)) {
      // ボード情報を取得して表示
      try {
        const apiHost = getApiHost()
        const res = await fetch(`${apiHost}/api/boards/info?boardId=${boardId}`)
        if (res.ok) {
          const board = await res.json()
          setJoinModalBoard({ id: board.id, title: board.title, visibility: board.visibility })
        }
      } catch (e) {
        console.error('Failed to fetch board info:', e)
      }
      return
    }
    setSelectedBoardId(boardId)
    if (window.innerWidth <= 900) setSidebarOpen(false)
  }, [])

  const handleJoinSuccess = useCallback((boardId: string, token: string, role: 'editor' | 'viewer') => {
    setAccessToken(boardId, token)
    setCurrentRole(role)
    setJoinModalBoard(null)
    setSelectedBoardId(boardId)
    if (window.innerWidth <= 900) setSidebarOpen(false)
  }, [])

  const handleRoleUpdate = useCallback((role: 'editor' | 'viewer') => {
    setCurrentRole(role)
  }, [])

  return (
    <div className="app-container">
      <header className="app-header">
        <div className="header-left">
          <button
            className="sidebar-toggle"
            onClick={() => setSidebarOpen((open) => !open)}
            aria-label="ホワイトボード一覧の表示切替"
          >
            ☰
          </button>
          <h1>Shared Whiteboard</h1>
        </div>
        <div className="status-indicator" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          {selectedBoardId && currentRole && (
            <span
              className={`role-badge ${currentRole}`}
              title={currentRole === 'editor' ? '編集者：描画できます' : '閲覧者：閲覧のみ可能'}
            >
              {currentRole === 'editor' ? '✏️ 編集者' : '👁 閲覧者'}
            </span>
          )}
          {selectedBoardId && currentRole === 'editor' && (
            <button
              className="invite-header-btn"
              onClick={() => setInviteModalBoardId(selectedBoardId)}
              title="招待リンクを共有"
            >
              🔗 招待
            </button>
          )}
          <button
            onClick={() => setSelectedBoardId('')}
            title="ホームに戻る"
            style={{ padding: '4px 8px', borderRadius: '4px', border: '1px solid #cbd5e1', background: '#f1f5f9', cursor: 'pointer', fontSize: '0.9rem', display: 'flex', alignItems: 'center', gap: '4px' }}
          >
            🏠 ホーム
          </button>
          <button
            onClick={() => window.location.reload()}
            title="ページを再読み込み"
            style={{ marginRight: '8px', padding: '4px 8px', borderRadius: '4px', border: '1px solid #cbd5e1', background: '#f1f5f9', cursor: 'pointer', fontSize: '0.9rem', display: 'flex', alignItems: 'center', gap: '4px' }}
          >
            🔄 更新
          </button>
          <span className="dot"></span>
          Live
        </div>
      </header>
      <div className="main-content">
        <aside className={`sidebar ${sidebarOpen ? 'open' : 'closed'}`}>
          <BoardSelector
            selectedBoardId={selectedBoardId}
            guestId={guestId}
            onBoardSelect={handleBoardSelect}
            onAccessTokenSet={setAccessToken}
            onRoleUpdate={handleRoleUpdate}
          />
        </aside>
        {sidebarOpen && <div className="sidebar-backdrop" onClick={() => setSidebarOpen(false)} />}
        <main>
          {selectedBoardId ? (
            <Whiteboard
              boardId={selectedBoardId}
              accessToken={getAccessToken(selectedBoardId)}
              onRoleUpdate={handleRoleUpdate}
            />
          ) : (
            <div className="welcome-screen">
              <h2>Shared Whiteboard へようこそ！</h2>
              <p>左上の「☰」メニューを開いて、ホワイトボードを選択または新規作成してください。</p>

              <button
                className="tutorial-btn"
                onClick={() => setTutorialOpen(true)}
              >
                📖 操作チュートリアルを見る
              </button>

              {tutorialOpen && (
                <div className="tutorial-modal-overlay" onClick={() => setTutorialOpen(false)}>
                  <div className="tutorial-modal-content" onClick={(e) => e.stopPropagation()}>
                    <h3>🎨 操作チュートリアル</h3>
                    <ul className="tutorial-list">
                      <li><strong>基本操作:</strong> 左上の「☰」からボードを作成，または選択してお絵描きスタート！</li>
                      <li><strong>パブリック / プライベート:</strong> ボード作成時に公開範囲を選択できます。プライベートはパスワードで入室。</li>
                      <li><strong>招待リンク:</strong> 編集者は「🔗 招待」ボタンから招待URLを共有できます。</li>
                      <li><strong>パレットの移動:</strong> パレット内の「🔒」を押すと，パレットが移動モードになり，自由にドラッグして移動できます．</li>
                      <li><strong>ツールの非表示:</strong> パレットが邪魔な時は「非表示」をタップ．画面右上の「表示」で元に戻せます．</li>
                      <li><strong>画面の移動:</strong> PCは右クリックでドラッグ，スマホは「2本指」でのドラッグで画面を移動できます．</li>
                      <li><strong>ペンと消しゴム:</strong> ✏️と🧽を押すと，それぞれ描画モードと消しゴムモードになります．</li>
                      <li><strong>テキスト入力:</strong> 「🔤」をタップすると，文字をキーボード入力できるようになります．</li>
                    </ul>
                    <button className="tutorial-close-btn" onClick={() => setTutorialOpen(false)}>
                      閉じる
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </main>
      </div>

      {/* パスワード入室モーダル */}
      {joinModalBoard && (
        <JoinBoardModal
          board={joinModalBoard}
          guestId={guestId}
          onSuccess={handleJoinSuccess}
          onClose={() => setJoinModalBoard(null)}
        />
      )}

      {/* 招待リンクモーダル */}
      {inviteModalBoardId && (
        <InviteModal
          boardId={inviteModalBoardId}
          accessToken={getAccessToken(inviteModalBoardId)}
          onClose={() => setInviteModalBoardId(null)}
        />
      )}
    </div>
  )
}

export default App
