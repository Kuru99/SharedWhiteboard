import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.tsx'
import AdminPage from './admin/AdminPage.tsx'
import './index.css'

const isAdminPage =
  new URLSearchParams(window.location.search).get('admin') === '1'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {isAdminPage ? <AdminPage /> : <App />}
  </React.StrictMode>,
)
