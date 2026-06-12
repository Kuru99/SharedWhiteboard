import { useState, useEffect } from 'react'
import Whiteboard from './components/Whiteboard'
import BoardSelector from './components/BoardSelector'
import './App.css'

function App() {
  const [selectedBoardId, setSelectedBoardId] = useState(() => {
    let isReload = false;
    if (window.performance) {
      const navEntries = window.performance.getEntriesByType("navigation") as PerformanceNavigationTiming[];
      if (navEntries.length > 0) {
        isReload = navEntries[0].type === "reload";
      } else if (window.performance.navigation) {
        isReload = window.performance.navigation.type === 1;
      }
    }

    if (isReload) {
      return sessionStorage.getItem('sharedwhiteboard_session_board') || '';
    } else {
      sessionStorage.removeItem('sharedwhiteboard_session_board');
      return '';
    }
  })
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [tutorialOpen, setTutorialOpen] = useState(false)

  useEffect(() => {
    if (selectedBoardId) {
      sessionStorage.setItem('sharedwhiteboard_session_board', selectedBoardId)
    } else {
      sessionStorage.removeItem('sharedwhiteboard_session_board')
    }
  }, [selectedBoardId])

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
        <div className="status-indicator" style={{ display: 'flex', alignItems: 'center' }}>
          <button 
            onClick={() => setSelectedBoardId('')}
            title="ホームに戻る"
            style={{ marginRight: '10px', padding: '4px 8px', borderRadius: '4px', border: '1px solid #cbd5e1', background: '#f1f5f9', cursor: 'pointer', fontSize: '0.9rem', display: 'flex', alignItems: 'center', gap: '4px' }}
          >
            🏠 ホーム
          </button>
          <button 
            onClick={() => window.location.reload()}
            title="ページを再読み込み"
            style={{ marginRight: '15px', padding: '4px 8px', borderRadius: '4px', border: '1px solid #cbd5e1', background: '#f1f5f9', cursor: 'pointer', fontSize: '0.9rem', display: 'flex', alignItems: 'center', gap: '4px' }}
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
            onBoardSelect={(id) => {
              setSelectedBoardId(id)
              if (window.innerWidth <= 900) {
                setSidebarOpen(false)
              }
            }}
          />
        </aside>
        {sidebarOpen && <div className="sidebar-backdrop" onClick={() => setSidebarOpen(false)} />}
        <main>
          {selectedBoardId ? (
            <Whiteboard boardId={selectedBoardId} />
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
    </div>
  )
}

export default App
