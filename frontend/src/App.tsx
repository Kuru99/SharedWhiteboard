import { useState, useEffect } from 'react'
import Whiteboard from './components/Whiteboard'
import BoardSelector from './components/BoardSelector'
import './App.css'

function App() {
  const [selectedBoardId, setSelectedBoardId] = useState(() => {
    return sessionStorage.getItem('sharedwhiteboard_session_board') || ''
  })
  const [sidebarOpen, setSidebarOpen] = useState(false)

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
            </div>
          )}
        </main>
      </div>
    </div>
  )
}

export default App
