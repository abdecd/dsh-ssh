import React, { useState, useEffect, useRef } from 'react'
import ReactDOM from 'react-dom'

interface SshHost {
  host: string
  hostName?: string
  user?: string
  port?: number
  identityFile?: string
  proxyJump?: string
  passwordAuthentication?: boolean
}

// ---------------------------------------------------------------------------
// Remote Folder Browser Modal Dialog (Safe Remote Directory Picker)
// ---------------------------------------------------------------------------

export function RemoteFolderBrowserModal({
  isOpen,
  onClose,
  onSelect,
  host,
  initialPath,
  password
}: {
  isOpen: boolean
  onClose: () => void
  onSelect: (selectedPath: string) => void
  host: string
  initialPath?: string
  password?: string
}) {
  const initial = initialPath?.trim() || '~'
  const [currentPath, setCurrentPath] = useState(initial)
  const [inputPath, setInputPath] = useState(initial)
  const [folders, setFolders] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [truncated, setTruncated] = useState(false)
  const reqSeq = useRef(0)

  const loadDirectory = async (targetPath: string) => {
    if (!host) return
    const reqId = ++reqSeq.current
    setCurrentPath(targetPath)
    setInputPath(targetPath)
    setLoading(true)
    setErrorMsg(null)
    try {
      const res = await fetch('/dsh-ssh/api/browse', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          host,
          path: targetPath,
          password
        })
      }).then((r) => r.json())

      if (reqId !== reqSeq.current) return

      if (res.ok) {
        const canonical = res.currentPath || targetPath
        setCurrentPath(canonical)
        setInputPath(canonical)
        setFolders(res.dirs || [])
        setTruncated(Boolean(res.truncated))
      } else {
        setErrorMsg(res.error || '读取目录失败')
      }
    } catch (err: any) {
      if (reqId === reqSeq.current) {
        setErrorMsg(err?.message || '网络请求错误')
      }
    } finally {
      if (reqId === reqSeq.current) {
        setLoading(false)
      }
    }
  }

  useEffect(() => {
    if (isOpen && host) {
      const start = initialPath?.trim() || '~'
      setCurrentPath(start)
      setInputPath(start)
      setFolders([])
      loadDirectory(start)
    }
  }, [isOpen, host, initialPath])

  if (!isOpen) return null

  const handleGoUp = () => {
    if (currentPath === '/' || !currentPath) return
    const parts = currentPath.split('/').filter(Boolean)
    parts.pop()
    const parent = '/' + (parts.join('/') || '')
    const resolvedParent = parent === '//' ? '/' : parent
    setCurrentPath(resolvedParent)
    setInputPath(resolvedParent)
    loadDirectory(resolvedParent)
  }

  const handleEnterFolder = (name: string) => {
    const next = currentPath === '/' ? `/${name}` : `${currentPath.replace(/\/+$/, '')}/${name}`
    setCurrentPath(next)
    setInputPath(next)
    loadDirectory(next)
  }

  const handleFolderDoubleClick = (name: string) => {
    const next = currentPath === '/' ? `/${name}` : `${currentPath.replace(/\/+$/, '')}/${name}`
    onSelect(next)
    onClose()
  }

  const handleInputSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (inputPath.trim()) {
      const target = inputPath.trim()
      setCurrentPath(target)
      loadDirectory(target)
    }
  }

  const handleConfirm = () => {
    onSelect(currentPath)
    onClose()
  }

  return ReactDOM.createPortal(
    <div
      className="dsh-ssh-modal-overlay"
      style={{ zIndex: 1000000 }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="dsh-ssh-modal-card" style={{ width: 560, maxWidth: '95vw' }}>
        {/* Header */}
        <div className="dsh-ssh-modal-header">
          <div className="dsh-ssh-modal-title">
            <span style={{ fontSize: '15px' }}>📂</span>
            <span>选择远程目录 ({host})</span>
          </div>
          <button type="button" className="dsh-ssh-modal-close" onClick={onClose} title="关闭">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Path Navigation Bar */}
        <div style={{ padding: '12px 18px 8px', borderBottom: '1px solid var(--dsw-alias-border-l2)' }}>
          <form onSubmit={handleInputSubmit} style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
            <button
              type="button"
              onClick={handleGoUp}
              disabled={loading || currentPath === '/'}
              className="dsh-ssh-btn-secondary"
              title="返回上一级"
              style={{ height: 32, padding: '0 10px', fontSize: '12px', flexShrink: 0, whiteSpace: 'nowrap' }}
            >
              ⬆ 上一级
            </button>
            <input
              type="text"
              value={inputPath}
              onChange={(e) => setInputPath(e.target.value)}
              className="dsh-ssh-input"
              style={{ height: 32, fontSize: '12px', flex: 1, minWidth: 0 }}
              placeholder="输入绝对路径按回车前往，如 /var/www"
            />
            <button
              type="button"
              onClick={() => loadDirectory(inputPath)}
              disabled={loading}
              className="dsh-ssh-btn-secondary"
              title="刷新"
              style={{ height: 32, padding: '0 10px', fontSize: '12px', flexShrink: 0, whiteSpace: 'nowrap' }}
            >
              {loading ? '...' : '前往'}
            </button>
          </form>
          {truncated && (
            <div style={{ fontSize: '11px', color: 'var(--dsw-alias-state-warning-primary, #b08800)', marginTop: 6 }}>
              ⚠️ 当前目录包含较多子文件夹，已限制展示前 200 项。
            </div>
          )}
        </div>

        {/* Folder List Box */}
        <div style={{ height: 280, overflowY: 'auto', padding: '6px 12px' }}>
          {loading && (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--dsw-alias-label-tertiary)', fontSize: '13px' }}>
              正在拉取远程目录...
            </div>
          )}

          {!loading && errorMsg && (
            <div style={{ padding: '24px 16px', textAlign: 'center' }}>
              <div style={{ color: 'var(--dsw-alias-state-error-primary, #cf222e)', fontSize: '13px', marginBottom: 12 }}>
                {errorMsg}
              </div>
              <button
                type="button"
                onClick={() => loadDirectory(currentPath)}
                className="dsh-ssh-btn-secondary"
                style={{ height: 30, fontSize: '12px' }}
              >
                重试
              </button>
            </div>
          )}

          {!loading && !errorMsg && folders.length === 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--dsw-alias-label-tertiary)', fontSize: '13px' }}>
              <div style={{ fontSize: 24, marginBottom: 6 }}>📁</div>
              <div>(当前目录下无子文件夹)</div>
              <div style={{ fontSize: 11, marginTop: 4, opacity: 0.8 }}>可以直接点击下方「选择当前目录」</div>
            </div>
          )}

          {!loading && !errorMsg && folders.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
              {folders.map((name) => (
                <div
                  key={name}
                  className="dsh-ssh-folder-item"
                  onClick={() => handleEnterFolder(name)}
                  onDoubleClick={() => handleFolderDoubleClick(name)}
                  title={`点击进入并更新路径，双击直接选择: ${name}`}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', overflow: 'hidden' }}>
                    <span style={{ fontSize: '14px', flexShrink: 0 }}>📁</span>
                    <span style={{ fontSize: '13px', textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }}>
                      {name}
                    </span>
                  </div>
                  <span style={{ fontSize: '12px', color: 'var(--dsw-alias-label-tertiary)', flexShrink: 0 }}>
                    进入 ›
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{
          padding: '12px 18px',
          borderTop: '1px solid var(--dsw-alias-border-l2)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          backgroundColor: 'var(--dsw-alias-bg-module-platform)',
          gap: '8px'
        }}>
          <div style={{ fontSize: '12px', color: 'var(--dsw-alias-label-secondary)', minWidth: 0, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            已选: <strong style={{ color: 'var(--dsw-alias-label-primary)' }}>{currentPath}</strong>
          </div>
          <div style={{ display: 'flex', gap: '8px', flexShrink: 0 }}>
            <button type="button" onClick={onClose} className="dsh-ssh-btn-secondary" style={{ height: 32, fontSize: '12px', flexShrink: 0, whiteSpace: 'nowrap' }}>
              取消
            </button>
            <button
              type="button"
              onClick={handleConfirm}
              className="dsh-ssh-btn-primary"
              style={{ height: 32, fontSize: '12px', flexShrink: 0, whiteSpace: 'nowrap' }}
            >
              ✓ 选择此目录
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  )
}

// ---------------------------------------------------------------------------
// Add Remote Workspace Modal Dialog (DSH Theme-Adaptive UI)
// ---------------------------------------------------------------------------

export function AddRemoteModal({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const [hosts, setHosts] = useState<SshHost[]>([])
  const [selectedHost, setSelectedHost] = useState('')
  const [remotePath, setRemotePath] = useState('')
  const [title, setTitle] = useState('')
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ ok: boolean; msg: string } | null>(null)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [isBrowserOpen, setIsBrowserOpen] = useState(false)

  const currentHost = hosts.find((h) => h.host === selectedHost)
  const isPasswordAuth = Boolean(currentHost?.passwordAuthentication)

  const handleOpenBrowser = () => {
    if (!selectedHost) {
      setErrorMsg('请先选择目标主机')
      return
    }
    if (isPasswordAuth && !password) {
      setErrorMsg('当前主机配置为密码登录，请先输入 SSH 登录密码后再浏览目录')
      return
    }
    setErrorMsg(null)
    setIsBrowserOpen(true)
  }

  const handleFolderSelect = (selectedPath: string) => {
    setRemotePath(selectedPath)
  }

  useEffect(() => {
    if (isOpen) {
      setErrorMsg(null)
      setTestResult(null)
      setPassword('')
      setRemotePath('')
      setTitle('')
      setIsBrowserOpen(false)
      fetch('/dsh-ssh/api/hosts')
        .then((r) => r.json())
        .then((res) => {
          if (res.ok && res.hosts?.length > 0) {
            setHosts(res.hosts)
            setSelectedHost(res.hosts[0].host)
          }
        })
        .catch(() => {})
    }
  }, [isOpen])

  if (!isOpen) return null

  const handleHostChange = (newHost: string) => {
    setSelectedHost(newHost)
    setTestResult(null)
    setPassword('')
  }

  const handleTest = async () => {
    if (!selectedHost) return
    setTesting(true)
    setTestResult(null)
    try {
      const res = await fetch('/dsh-ssh/api/test', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          host: selectedHost,
          password: isPasswordAuth ? password : undefined
        })
      }).then((r) => r.json())
      setTestResult({ ok: res.ok, msg: res.message || (res.ok ? '连接成功' : '连接失败') })
    } catch (e: any) {
      setTestResult({ ok: false, msg: e?.message || '网络请求错误' })
    } finally {
      setTesting(false)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!selectedHost || !remotePath.trim()) {
      setErrorMsg('请选择主机并填写远程项目绝对路径')
      return
    }
    if (isPasswordAuth && !password) {
      setErrorMsg('当前主机配置为密码登录，请输入 SSH 登录密码')
      return
    }

    setSubmitting(true)
    setErrorMsg(null)
    try {
      const res = await fetch('/dsh-ssh/api/create-workspace', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          host: selectedHost,
          remotePath: remotePath.trim(),
          title: title.trim() || undefined,
          authType: isPasswordAuth ? 'password' : 'key',
          password: isPasswordAuth ? password : undefined
        })
      }).then((r) => r.json())

      if (res.ok) {
        onClose()
        window.location.reload()
      } else {
        setErrorMsg(res.error || '创建远程工作区失败')
      }
    } catch (err: any) {
      setErrorMsg(err?.message || '请求错误')
    } finally {
      setSubmitting(false)
    }
  }

  return ReactDOM.createPortal(
    <>
      <div
        className="dsh-ssh-modal-overlay"
        onClick={(e) => {
          if (e.target === e.currentTarget) onClose()
        }}
      >
        <div className="dsh-ssh-modal-card">
          {/* Header */}
          <div className="dsh-ssh-modal-header">
            <div className="dsh-ssh-modal-title">
              <svg width="16" height="16" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path fillRule="evenodd" clipRule="evenodd" d="M7.00018 0.353516C10.6708 0.353535 13.6468 3.32958 13.6469 7.00018C13.6468 10.6708 10.6708 13.6468 7.00018 13.6469C3.32957 13.6468 0.353535 10.6708 0.353516 7.00018C0.353535 3.32957 3.32957 0.353531 7.00018 0.353516ZM5.44643 7.59661C5.49463 8.97506 5.70762 10.191 6.02136 11.0793C6.20141 11.5891 6.40328 11.9585 6.59898 12.1889C6.79501 12.4196 6.93213 12.454 7.00018 12.454C7.06822 12.454 7.20533 12.4197 7.40138 12.1889C7.59708 11.9585 7.79895 11.589 7.979 11.0793C8.29274 10.191 8.50574 8.97506 8.55394 7.59661H5.44643ZM1.57861 7.59661C1.80785 9.70467 3.2386 11.4509 5.1715 12.1388C5.07135 11.9317 4.97972 11.7098 4.89746 11.477C4.53084 10.4391 4.30224 9.0828 4.25357 7.59661H1.57861ZM9.74679 7.59661C9.69813 9.0828 9.46952 10.4391 9.1029 11.477C9.0206 11.7099 8.92818 11.9316 8.82797 12.1388C10.7613 11.4511 12.1925 9.70496 12.4218 7.59661H9.74679ZM5.1706 1.8616C3.23814 2.54963 1.80876 4.29604 1.5795 6.40376H4.25357C4.30224 4.91756 4.53083 3.56129 4.89746 2.5234C4.97968 2.29066 5.07051 2.0686 5.1706 1.8616ZM7.00018 1.54637C6.93213 1.54638 6.79503 1.5807 6.59898 1.81145C6.40332 2.04177 6.20139 2.41058 6.02136 2.92012C5.70754 3.80851 5.49461 5.02499 5.44643 6.40376H8.55394C8.50575 5.025 8.29282 3.80851 7.979 2.92012C7.79898 2.41059 7.59705 2.04177 7.40138 1.81145C7.20531 1.58067 7.06823 1.54637 7.00018 1.54637ZM8.82887 1.8616C8.92902 2.0687 9.02064 2.29053 9.1029 2.5234C9.46953 3.56129 9.69812 4.91756 9.74679 6.40376H12.4209C12.1916 4.29575 10.7618 2.54943 8.82887 1.8616Z" fill="currentColor"/>
              </svg>
              <span>添加远程工作区 (SSH)</span>
            </div>
            <button
              type="button"
              className="dsh-ssh-modal-close"
              onClick={onClose}
              title="关闭"
              aria-label="关闭"
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>

          {/* Form Body */}
          <form onSubmit={handleSubmit} className="dsh-ssh-modal-body">
          {/* Hidden username input to enable browser credential management */}
          <input
            type="text"
            name="username"
            value={selectedHost}
            readOnly
            tabIndex={-1}
            autoComplete="username"
            style={{ position: 'absolute', opacity: 0, pointerEvents: 'none', height: 0, width: 0 }}
          />

          {errorMsg && (
            <div
              style={{
                padding: '10px 14px',
                borderRadius: '8px',
                marginBottom: '16px',
                fontSize: '13px',
                backgroundColor: 'rgba(248, 81, 73, 0.1)',
                border: '1px solid rgba(248, 81, 73, 0.25)',
                color: 'var(--dsw-alias-state-error-primary, #cf222e)'
              }}
            >
              {errorMsg}
            </div>
          )}

          <div style={{ marginBottom: '16px' }}>
            <label className="dsh-ssh-label">
              目标主机 <span style={{ fontWeight: 'normal', color: 'var(--dsw-alias-label-tertiary)' }}>(来自 ~/.ssh/config)</span>
            </label>
            <div style={{ display: 'flex', gap: '8px' }}>
              <select
                value={selectedHost}
                onChange={(e) => handleHostChange(e.target.value)}
                className="dsh-ssh-select"
                style={{ flex: 1, minWidth: 0 }}
              >
                {hosts.map((h) => (
                  <option key={h.host} value={h.host}>
                    {h.host} {h.hostName ? `(${h.user || 'user'}@${h.hostName})` : ''}
                    {h.passwordAuthentication ? ' [密码登录]' : ''}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={handleTest}
                disabled={testing}
                className="dsh-ssh-btn-secondary"
                style={{ flexShrink: 0, whiteSpace: 'nowrap' }}
              >
                {testing ? '测试中...' : '测试连接'}
              </button>
            </div>

            {isPasswordAuth && (
              <div style={{ marginTop: '12px' }}>
                <label className="dsh-ssh-label">
                  SSH 登录密码 <span style={{ color: 'var(--dsw-alias-state-error-primary, #cf222e)' }}>*</span>
                  <span style={{ fontWeight: 'normal', color: 'var(--dsw-alias-label-tertiary)', marginLeft: 6 }}>
                    (检测到 PasswordAuthentication，密码由浏览器保管)
                  </span>
                </label>
                <input
                  type="password"
                  name="password"
                  autoComplete="current-password"
                  required
                  className="dsh-ssh-input"
                  placeholder="输入 SSH 登录密码（可被浏览器保存）"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </div>
            )}

            {testResult && (
              <div
                style={{
                  fontSize: '12px',
                  marginTop: '8px',
                  fontWeight: 500,
                  color: testResult.ok
                    ? 'var(--dsw-alias-state-success-primary, #1a7f37)'
                    : 'var(--dsw-alias-state-error-primary, #cf222e)'
                }}
              >
                {testResult.ok ? '✓ ' : '✕ '} {testResult.msg}
              </div>
            )}
          </div>

          <div style={{ marginBottom: '16px' }}>
            <label className="dsh-ssh-label">
              远程目录绝对路径 (Remote Path) <span style={{ color: 'var(--dsw-alias-state-error-primary, #cf222e)' }}>*</span>
            </label>
            <div style={{ display: 'flex', gap: '8px' }}>
              <input
                type="text"
                required
                autoFocus
                className="dsh-ssh-input"
                placeholder="例如: /root/code/my-app 或 /home/ubuntu/project"
                value={remotePath}
                onChange={(e) => setRemotePath(e.target.value)}
                style={{ flex: 1, minWidth: 0 }}
              />
              <button
                type="button"
                onClick={handleOpenBrowser}
                className="dsh-ssh-btn-secondary"
                title="浏览远程服务器目录"
                style={{ flexShrink: 0, whiteSpace: 'nowrap' }}
              >
                <span>浏览...</span>
              </button>
            </div>
          </div>

          <div style={{ marginBottom: '22px' }}>
            <label className="dsh-ssh-label">
              工作区自定义名称 <span style={{ fontWeight: 'normal', color: 'var(--dsw-alias-label-tertiary)' }}>(可选)</span>
            </label>
            <input
              type="text"
              className="dsh-ssh-input"
              placeholder="留空则默认使用目录名 (如: my-app)"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>

          {/* Footer Actions */}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', paddingTop: '4px' }}>
            <button
              type="button"
              onClick={onClose}
              className="dsh-ssh-btn-secondary"
            >
              取消
            </button>
            <button
              type="submit"
              disabled={submitting || !remotePath.trim() || (isPasswordAuth && !password)}
              className="dsh-ssh-btn-primary"
            >
              {submitting ? '创建中...' : '创建工作区'}
            </button>
          </div>
        </form>
      </div>
    </div>
    {isBrowserOpen && (
      <RemoteFolderBrowserModal
        isOpen={isBrowserOpen}
        onClose={() => setIsBrowserOpen(false)}
        onSelect={handleFolderSelect}
        host={selectedHost}
        initialPath={remotePath.trim() || '~'}
        password={isPasswordAuth ? password : undefined}
      />
    )}
  </>,
  document.body
)
}

// ---------------------------------------------------------------------------
// ReAuth Modal Dialog (Automatic Reconnection via Browser Password Autofill)
// ---------------------------------------------------------------------------

export function ReAuthModal({
  host,
  isOpen,
  onClose,
  onSuccess
}: {
  host: string
  isOpen: boolean
  onClose: () => void
  onSuccess?: () => void
}) {
  const [rePassword, setRePassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  useEffect(() => {
    if (isOpen) {
      setErrorMsg(null)
      setRePassword('')
    }
  }, [isOpen])

  if (!isOpen || !host) return null

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!rePassword) return

    setSubmitting(true)
    setErrorMsg(null)
    try {
      const res = await fetch('/dsh-ssh/api/auth-submit', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ host, password: rePassword })
      }).then((r) => r.json())

      if (res.ok) {
        onSuccess?.()
        onClose()
      } else {
        setErrorMsg(res.error || '认证失败，请检查密码')
      }
    } catch (err: any) {
      setErrorMsg(err?.message || '网络请求错误')
    } finally {
      setSubmitting(false)
    }
  }

  return ReactDOM.createPortal(
    <div
      className="dsh-ssh-modal-overlay"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="dsh-ssh-modal-card" style={{ width: 440 }}>
        <div className="dsh-ssh-modal-header">
          <div className="dsh-ssh-modal-title">
            <span>🔐 重新输入远程密码</span>
          </div>
          <button type="button" className="dsh-ssh-modal-close" onClick={onClose} title="关闭">
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <form onSubmit={handleSubmit} className="dsh-ssh-modal-body">
          <input
            type="text"
            name="username"
            value={host}
            readOnly
            tabIndex={-1}
            autoComplete="username"
            style={{ position: 'absolute', opacity: 0, pointerEvents: 'none', height: 0, width: 0 }}
          />

          <div style={{ marginBottom: '14px', fontSize: '13px', lineHeight: '20px', color: 'var(--dsw-alias-label-secondary)' }}>
            主机 <strong style={{ color: 'var(--dsw-alias-label-primary)' }}>{host}</strong> 的连接需密码验证（或此前内存中的密码已过期）。
            若浏览器已保存密码已为你自动填充，确认即可恢复连接。
          </div>

          {errorMsg && (
            <div
              style={{
                padding: '10px 14px',
                borderRadius: '8px',
                marginBottom: '16px',
                fontSize: '13px',
                backgroundColor: 'rgba(248, 81, 73, 0.1)',
                border: '1px solid rgba(248, 81, 73, 0.25)',
                color: 'var(--dsw-alias-state-error-primary, #cf222e)'
              }}
            >
              {errorMsg}
            </div>
          )}

          <div style={{ marginBottom: '20px' }}>
            <label className="dsh-ssh-label">
              SSH 登录密码 <span style={{ color: 'var(--dsw-alias-state-error-primary, #cf222e)' }}>*</span>
            </label>
            <input
              type="password"
              name="password"
              autoComplete="current-password"
              autoFocus
              required
              className="dsh-ssh-input"
              placeholder="输入或确认密码"
              value={rePassword}
              onChange={(e) => setRePassword(e.target.value)}
            />
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
            <button type="button" onClick={onClose} className="dsh-ssh-btn-secondary">
              取消
            </button>
            <button type="submit" disabled={submitting || !rePassword} className="dsh-ssh-btn-primary">
              {submitting ? '验证中...' : '确认并连接'}
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body
  )
}

// ---------------------------------------------------------------------------
// Global Sidebar Button Injector (Adds 🌐 to Workspace Section Header)
// ---------------------------------------------------------------------------

let openModalGlobal: () => void = () => {}
let openReAuthGlobal: (host: string) => void = () => {}

function GlobalModalHost() {
  const [isOpen, setIsOpen] = useState(false)
  const [reAuthHost, setReAuthHost] = useState<string | null>(null)

  useEffect(() => {
    openModalGlobal = () => setIsOpen(true)
    openReAuthGlobal = (h: string) => setReAuthHost(h)
  }, [])

  return (
    <>
      <AddRemoteModal isOpen={isOpen} onClose={() => setIsOpen(false)} />
      <ReAuthModal
        host={reAuthHost || ''}
        isOpen={Boolean(reAuthHost)}
        onClose={() => setReAuthHost(null)}
        onSuccess={() => {
          setReAuthHost(null)
          window.dispatchEvent(new CustomEvent('dsh-ssh-reauth-success', { detail: { host: reAuthHost } }))
        }}
      />
    </>
  )
}

function initSidebarButton() {
  // Hook window.fetch once to catch 401 needAuth requests from better-sidebar or tools
  if (typeof window !== 'undefined' && !(window as any).__dsh_ssh_fetch_hooked__) {
    ;(window as any).__dsh_ssh_fetch_hooked__ = true
    const origFetch = window.fetch
    window.fetch = async function (input: RequestInfo | URL, init?: RequestInit) {
      const res = await origFetch.call(this, input, init)
      const url = typeof input === 'string' ? input : (input && typeof input === 'object' && 'url' in input ? (input as Request).url : String(input || ''))
      if (url.includes('/sidebar/api/fs') || url.includes('/dsh-ssh/api/')) {
        if (res.status === 401) {
          try {
            const clone = res.clone()
            const data = await clone.json()
            if (data && data.needAuth && data.host) {
              openReAuthGlobal(data.host)
            }
          } catch {}
        }
      }
      return res
    }
  }

  let style = document.getElementById('dsh-ssh-styles') as HTMLStyleElement | null
  if (!style) {
    style = document.createElement('style')
    style.id = 'dsh-ssh-styles'
    document.head.appendChild(style)
  }
  style.textContent = `
    [class*="sectionHeader"] [class*="headerActions"] {
      max-width: none;
      overflow: visible;
    }
    #dsh-ssh-add-remote-btn {
      width: 28px;
      height: 28px;
      border-radius: 50%;
      corner-shape: round;
      border: none;
      background: transparent;
      color: var(--dsw-alias-label-secondary);
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      padding: 0;
      margin: 0;
      flex: none;
      box-sizing: border-box;
      transition: background-color 0.15s, color 0.15s;
    }
    #dsh-ssh-add-remote-btn:hover {
      background: var(--dsw-alias-interactive-bg-hover);
      color: var(--dsw-alias-label-primary);
    }
    #dsh-ssh-add-remote-btn svg {
      width: 15px;
      height: 15px;
      display: block;
      flex-shrink: 0;
      transition: width 0.15s, height 0.15s;
    }

    /* Collapsed sidebar (rail mode) adaptive styles matching native 36px rail controls */
    [class*="rail"] #dsh-ssh-add-remote-btn {
      width: 36px;
      height: 36px;
      color: var(--dsw-alias-label-primary);
    }
    [class*="rail"] #dsh-ssh-add-remote-btn:hover {
      background: var(--dsw-alias-interactive-bg-hover);
      color: var(--dsw-alias-label-primary);
    }
    [class*="rail"] #dsh-ssh-add-remote-btn svg {
      width: 18px;
      height: 18px;
    }
    [class*="rail"] [class*="sectionHeader"] {
      height: auto;
      justify-content: center;
      align-items: center;
    }
    [class*="rail"] [class*="headerActions"] {
      width: 36px;
      flex-direction: column;
      gap: 12px;
      align-items: center;
      justify-content: center;
    }
    @keyframes dshSshFadeIn {
      from { opacity: 0; transform: scale(0.98); }
      to { opacity: 1; transform: scale(1); }
    }

      /* 100% Theme-adaptive dialog styles using real DSH variables */
      .dsh-ssh-modal-overlay {
        position: fixed;
        inset: 0;
        background-color: var(--dsw-alias-bg-mask-1, rgba(0, 0, 0, 0.45));
        backdrop-filter: blur(var(--dsw-mask-blur, 4px));
        z-index: 999999;
        display: flex;
        align-items: center;
        justify-content: center;
        animation: dshSshFadeIn 0.12s cubic-bezier(0.16, 1, 0.3, 1);
      }
      .dsh-ssh-modal-card {
        box-sizing: border-box;
        width: 480px;
        max-width: min(520px, 92vw);
        background: var(--dsw-alias-bg-base) !important;
        border: 1px solid var(--dsw-alias-border-l1) !important;
        border-radius: 12px;
        box-shadow: var(--dsw-elevation-modal, 0 16px 36px rgba(0, 0, 0, 0.28));
        overflow: hidden;
        color: var(--dsw-alias-label-primary);
      }
      .dsh-ssh-modal-card *,
      .dsh-ssh-modal-card *::before,
      .dsh-ssh-modal-card *::after {
        box-sizing: border-box;
      }
      .dsh-ssh-modal-body {
        padding: 20px 22px;
      }
      @media (max-width: 480px) {
        .dsh-ssh-modal-card {
          max-width: 95vw;
        }
        .dsh-ssh-modal-body {
          padding: 16px 16px;
        }
        .dsh-ssh-modal-header {
          padding: 12px 16px !important;
        }
      }
      .dsh-ssh-modal-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 14px 20px;
        border-bottom: 1px solid var(--dsw-alias-border-l2);
      }
      .dsh-ssh-modal-title {
        display: flex;
        align-items: center;
        gap: 8px;
        font-size: 14px;
        font-weight: 600;
        color: var(--dsw-alias-label-primary);
      }
      .dsh-ssh-modal-close {
        width: 24px;
        height: 24px;
        border-radius: 6px;
        border: none;
        background: transparent;
        color: var(--dsw-alias-label-tertiary);
        cursor: pointer;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        padding: 0;
        transition: color 0.15s, background-color 0.15s;
        flex-shrink: 0;
      }
      .dsh-ssh-modal-close:hover {
        background: var(--dsw-alias-interactive-bg-hover);
        color: var(--dsw-alias-label-primary);
      }
      .dsh-ssh-label {
        display: block;
        font-size: 13px;
        font-weight: 500;
        margin-bottom: 6px;
        color: var(--dsw-alias-label-primary);
      }
      .dsh-ssh-input {
        width: 100%;
        min-width: 0;
        box-sizing: border-box;
        height: 34px;
        padding: 0 10px;
        border-radius: 8px;
        border: 1px solid var(--dsw-alias-border-l2) !important;
        background: var(--dsw-alias-bg-module-platform) !important;
        color: var(--dsw-alias-label-primary) !important;
        font-size: 13px;
        outline: none;
        transition: border-color 0.15s;
      }
      .dsh-ssh-input:focus {
        border-color: var(--dsw-alias-state-business-primary) !important;
      }
      .dsh-ssh-select {
        min-width: 0;
        max-width: 100%;
        box-sizing: border-box;
        height: 34px;
        padding: 0 10px;
        border-radius: 8px;
        border: 1px solid var(--dsw-alias-border-l2) !important;
        background: var(--dsw-alias-bg-module-platform) !important;
        color: var(--dsw-alias-label-primary) !important;
        font-size: 13px;
        outline: none;
        cursor: pointer;
        text-overflow: ellipsis;
        white-space: nowrap;
        overflow: hidden;
      }
      .dsh-ssh-select:focus {
        border-color: var(--dsw-alias-state-business-primary) !important;
      }
      .dsh-ssh-btn-secondary {
        height: 34px;
        padding: 0 14px;
        border-radius: 8px;
        border: 1px solid var(--dsw-alias-border-l1) !important;
        background: var(--dsw-alias-bg-base) !important;
        color: var(--dsw-alias-label-primary) !important;
        font-size: 13px;
        font-weight: 500;
        cursor: pointer;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        transition: background-color 0.15s ease;
        white-space: nowrap;
        flex-shrink: 0;
      }
      .dsh-ssh-btn-secondary:hover:not(:disabled) {
        background: var(--dsw-alias-interactive-bg-hover) !important;
      }
      .dsh-ssh-btn-primary {
        height: 34px;
        padding: 0 18px;
        border-radius: 8px;
        border: none !important;
        background: var(--dsw-alias-button-primary-fill) !important;
        color: var(--dsw-alias-label-primary-inverted, #ffffff) !important;
        font-size: 13px;
        font-weight: 600;
        cursor: pointer;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        transition: background-color 0.15s ease;
        white-space: nowrap;
        flex-shrink: 0;
      }
      .dsh-ssh-btn-primary:hover:not(:disabled) {
        background: var(--dsw-alias-button-primary-hover) !important;
      }
      .dsh-ssh-btn-primary:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }
      .dsh-ssh-folder-item {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 7px 10px;
        border-radius: 6px;
        cursor: pointer;
        user-select: none;
        transition: background-color 0.12s ease;
        color: var(--dsw-alias-label-primary);
      }
      .dsh-ssh-folder-item:hover {
        background-color: var(--dsw-alias-interactive-bg-hover) !important;
      }
    `

  // Mount modal container in document.body
  let modalHost = document.getElementById('dsh-ssh-modal-host')
  if (!modalHost) {
    modalHost = document.createElement('div')
    modalHost.id = 'dsh-ssh-modal-host'
    document.body.appendChild(modalHost)
    ReactDOM.render(<GlobalModalHost />, modalHost)
  }

  // Inject Button into Workspace headerActions next to the native add button
  const tryInjectButton = () => {
    if (document.getElementById('dsh-ssh-add-remote-btn')) return

    const headerActions =
      document.querySelector('[class*="sectionHeader"] [class*="headerActions"]') ||
      document.querySelector('[class*="headerActions"]')
    if (!headerActions) return

    const nativeAddBtn =
      document.querySelector('button[aria-label="添加工作区"], button[aria-label="Add workspace"], button[aria-label*="工作区"]') ||
      headerActions.querySelector('button:last-child')

    const btn = document.createElement('button')
    btn.id = 'dsh-ssh-add-remote-btn'
    btn.type = 'button'
    btn.className = 'dsh-ssh-header-btn'
    btn.setAttribute('aria-label', '添加远程工作区')
    btn.title = '添加远程工作区 (SSH)'
    btn.innerHTML = `
      <svg width="15" height="15" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path fill-rule="evenodd" clip-rule="evenodd" d="M7.00018 0.353516C10.6708 0.353535 13.6468 3.32958 13.6469 7.00018C13.6468 10.6708 10.6708 13.6468 7.00018 13.6469C3.32957 13.6468 0.353535 10.6708 0.353516 7.00018C0.353535 3.32957 3.32957 0.353531 7.00018 0.353516ZM5.44643 7.59661C5.49463 8.97506 5.70762 10.191 6.02136 11.0793C6.20141 11.5891 6.40328 11.9585 6.59898 12.1889C6.79501 12.4196 6.93213 12.454 7.00018 12.454C7.06822 12.454 7.20533 12.4197 7.40138 12.1889C7.59708 11.9585 7.79895 11.589 7.979 11.0793C8.29274 10.191 8.50574 8.97506 8.55394 7.59661H5.44643ZM1.57861 7.59661C1.80785 9.70467 3.2386 11.4509 5.1715 12.1388C5.07135 11.9317 4.97972 11.7098 4.89746 11.477C4.53084 10.4391 4.30224 9.0828 4.25357 7.59661H1.57861ZM9.74679 7.59661C9.69813 9.0828 9.46952 10.4391 9.1029 11.477C9.0206 11.7099 8.92818 11.9316 8.82797 12.1388C10.7613 11.4511 12.1925 9.70496 12.4218 7.59661H9.74679ZM5.1706 1.8616C3.23814 2.54963 1.80876 4.29604 1.5795 6.40376H4.25357C4.30224 4.91756 4.53083 3.56129 4.89746 2.5234C4.97968 2.29066 5.07051 2.0686 5.1706 1.8616ZM7.00018 1.54637C6.93213 1.54638 6.79503 1.5807 6.59898 1.81145C6.40332 2.04177 6.20139 2.41058 6.02136 2.92012C5.70754 3.80851 5.49461 5.02499 5.44643 6.40376H8.55394C8.50575 5.025 8.29282 3.80851 7.979 2.92012C7.79898 2.41059 7.59705 2.04177 7.40138 1.81145C7.20531 1.58067 7.06823 1.54637 7.00018 1.54637ZM8.82887 1.8616C8.92902 2.0687 9.02064 2.29053 9.1029 2.5234C9.46953 3.56129 9.69812 4.91756 9.74679 6.40376H12.4209C12.1916 4.29575 10.7618 2.54943 8.82887 1.8616Z" fill="currentColor"/>
      </svg>
    `
    btn.onclick = (e) => {
      e.stopPropagation()
      openModalGlobal()
    }

    if (nativeAddBtn && nativeAddBtn.parentElement === headerActions) {
      headerActions.insertBefore(btn, nativeAddBtn)
    } else {
      headerActions.appendChild(btn)
    }
  }

  setInterval(tryInjectButton, 1000)
  const observer = new MutationObserver(tryInjectButton)
  observer.observe(document.body, { childList: true, subtree: true })
}

export const inject = ['slots']

export function apply(_ctx: any) {
  if (typeof window !== 'undefined' && typeof document !== 'undefined') {
    initSidebarButton()
  }
}
