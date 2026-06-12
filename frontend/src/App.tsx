import { useState, useEffect } from 'react'
import Whiteboard from './components/Whiteboard'
import BoardSelector from './components/BoardSelector'
import './App.css'

function App() {
  const [selectedBoardId, setSelectedBoardId] = useState(() => {
    return sessionStorage.getItem('sharedwhiteboard_session_board') || ''
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
        <div className="status-indicator">
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
                      <li><strong>基本操作:</strong> 左上の「☰」からボードを選んでお絵描きスタート！</li>
                      <li><strong>パレットの移動:</strong> パレット内の「🔒」を押して「🔓」にすると、自由にドラッグして移動できます。</li>
                      <li><strong>ツールの非表示:</strong> パレットが邪魔な時は「非表示」をタップ。画面右上の「表示」で元に戻せます。</li>
                      <li><strong>テキスト入力:</strong> 「🔤」を選んで画面をタップすると、文字を入力できます。</li>
                      <li><strong>画面の移動（パン）:</strong> PCは右クリックや中ボタンでのドラッグ、スマホは「2本指」でのドラッグで画面を移動できます。</li>
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
