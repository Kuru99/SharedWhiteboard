import { useEffect, useState } from 'react'
import './AdminPage.css'

type AdminBoard = {
  id: string
  title: string
  visibility: string
  createdAt: string
}

const getApiHost = () => {
  const envHost = import.meta.env.VITE_API_BASE_URL

  if (envHost && envHost !== '') {
    return envHost
  }

  const protocol =
    window.location.protocol === 'https:' ? 'https:' : 'http:'

  return `${protocol}//${window.location.hostname}:8000`
}


export default function AdminPage() {
  useEffect(() => {
  document.body.classList.add('admin-body')

  return () => {
    document.body.classList.remove('admin-body')
  }
  }, [])
  const [token, setToken] = useState('')
  const [boards, setBoards] = useState<AdminBoard[]>([])
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')

  const apiHost = getApiHost()

  const loadBoards = async () => {
    if (!token.trim()) {
      setError('管理者トークンを入力してください。')
      return
    }

    setLoading(true)
    setError('')
    setMessage('')

    try {
      const response = await fetch(`${apiHost}/api/admin/boards/list`, {
        method: 'POST',
        headers: {
          'X-Admin-Token': token,
        },
      })

      if (!response.ok) {
        if (response.status === 401) {
          throw new Error('管理者トークンが正しくありません。')
        }

        throw new Error(`一覧の取得に失敗しました（${response.status}）。`)
      }

      const data: AdminBoard[] = await response.json()
      setBoards(data)
      setMessage(`${data.length} 件のボードを取得しました。`)
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : '一覧の取得中にエラーが発生しました。',
      )
    } finally {
      setLoading(false)
    }
  }

  const deleteBoard = async (board: AdminBoard) => {
    const confirmed = window.confirm(
      `本当に「${board.title}」を削除しますか？\nこの操作は取り消せません。`,
    )

    if (!confirmed) return

    setLoading(true)
    setError('')
    setMessage('')

    try {
      const response = await fetch(`${apiHost}/api/admin/boards/delete`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Admin-Token': token,
        },
        body: JSON.stringify({
          boardId: board.id,
        }),
      })

      if (!response.ok) {
        if (response.status === 401) {
          throw new Error('管理者トークンが正しくありません。')
        }

        if (response.status === 404) {
          throw new Error('対象のボードが見つかりません。')
        }

        throw new Error(`削除に失敗しました（${response.status}）。`)
      }

      setBoards((current) =>
        current.filter((item) => item.id !== board.id),
      )
      setMessage(`「${board.title}」を削除しました。`)
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : '削除中にエラーが発生しました。',
      )
    } finally {
      setLoading(false)
    }
  }

  const filteredBoards = boards.filter((board) =>
    board.title.toLowerCase().includes(search.trim().toLowerCase()),
  )

  return (
    <main className="admin-page">
      <header className="admin-header">
        <p className="admin-eyebrow">SHARE WHITEBOARD</p>
        <h1>管理者向けボード管理</h1>
        <p className="admin-description">
          ボード一覧を確認し、不要なボードを削除できます。
        </p>
      </header>

      <section className="admin-panel">
        <label htmlFor="admin-token">管理者トークン</label>

        <div className="admin-token-row">
          <input
            id="admin-token"
            type="password"
            autoComplete="off"
            value={token}
            onChange={(event) => setToken(event.target.value)}
            placeholder="管理者トークンを入力"
          />

          <button
            type="button"
            onClick={loadBoards}
            disabled={loading}
          >
            {loading ? '処理中…' : '一覧を取得'}
          </button>
        </div>

        <p className="admin-hint">
          トークンはこの画面のメモリ上だけで扱い、ブラウザには保存しません。
        </p>

        {error && <p className="admin-error">{error}</p>}
        {message && <p className="admin-message">{message}</p>}
      </section>

      <section className="admin-panel">
        <div className="admin-list-heading">
          <h2>ボード一覧</h2>
          <span>{filteredBoards.length} 件</span>
        </div>

        <label htmlFor="board-search">ボード名で検索</label>
        <input
          id="board-search"
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="ボード名を入力"
        />

        {boards.length === 0 ? (
          <p className="admin-empty">
            ボード一覧を取得すると、ここに表示されます。
          </p>
        ) : filteredBoards.length === 0 ? (
          <p className="admin-empty">一致するボードがありません。</p>
        ) : (
          <ul className="admin-board-list">
            {filteredBoards.map((board) => (
              <li className="admin-board-item" key={board.id}>
                <div className="admin-board-info">
                  <h3>{board.title || '名称未設定'}</h3>

                  <div className="admin-board-meta">
                    <span
                      className={
                        board.visibility === 'private'
                          ? 'admin-visibility private'
                          : 'admin-visibility public'
                      }
                    >
                      {board.visibility === 'private' ? '非公開' : '公開'}
                    </span>

                    <span>
                      作成日時：
                      {Number.isNaN(Date.parse(board.createdAt))
                        ? '不明'
                        : new Date(board.createdAt).toLocaleString('ja-JP')}
                    </span>
                  </div>
                </div>

                <button
                  type="button"
                  className="admin-delete-button"
                  onClick={() => deleteBoard(board)}
                  disabled={loading}
                >
                  削除
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  )
}