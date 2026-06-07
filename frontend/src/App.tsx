import { useState } from 'react'
import Whiteboard from './components/Whiteboard'
import BoardSelector from './components/BoardSelector'
import './App.css'

function App() {
  const [selectedBoardId, setSelectedBoardId] = useState('default')
  const [sidebarOpen, setSidebarOpen] = useState(true)

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
          <Whiteboard boardId={selectedBoardId} />
        </main>
      </div>
    </div>
  )
}

export default App
