import React, { useState, useEffect } from 'react'
import ReactDOM from 'react-dom'

interface SshHost {
  host: string
  hostName?: string
  user?: string
  port?: number
  identityFile?: string
  proxyJump?: string
}

// ---------------------------------------------------------------------------
// Add Remote Workspace Modal Dialog (DSH Theme-Adaptive UI)
// ---------------------------------------------------------------------------

export function AddRemoteModal({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const [hosts, setHosts] = useState<SshHost[]>([])
  const [selectedHost, setSelectedHost] = useState('')
  const [remotePath, setRemotePath] = useState('')
  const [title, setTitle] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ ok: boolean; msg: string } | null>(null)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  useEffect(() => {
    if (isOpen) {
      setErrorMsg(null)
      setTestResult(null)
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

  const handleTest = async () => {
    if (!selectedHost) return
    setTesting(true)
    setTestResult(null)
    try {
      const res = await fetch('/dsh-ssh/api/test', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ host: selectedHost })
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

    setSubmitting(true)
    setErrorMsg(null)
    try {
      const res = await fetch('/dsh-ssh/api/create-workspace', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          host: selectedHost,
          remotePath: remotePath.trim(),
          title: title.trim() || undefined
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
        <form onSubmit={handleSubmit} style={{ padding: '20px 22px' }}>
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
                onChange={(e) => setSelectedHost(e.target.value)}
                className="dsh-ssh-select"
                style={{ flex: 1 }}
              >
                {hosts.map((h) => (
                  <option key={h.host} value={h.host}>
                    {h.host} {h.hostName ? `(${h.user || 'user'}@${h.hostName})` : ''}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={handleTest}
                disabled={testing}
                className="dsh-ssh-btn-secondary"
              >
                {testing ? '测试中...' : '测试连接'}
              </button>
            </div>
            {testResult && (
              <div
                style={{
                  fontSize: '12px',
                  marginTop: '6px',
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
            <input
              type="text"
              required
              autoFocus
              className="dsh-ssh-input"
              placeholder="例如: /root/code/my-app 或 /home/ubuntu/project"
              value={remotePath}
              onChange={(e) => setRemotePath(e.target.value)}
            />
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
              disabled={submitting || !remotePath.trim()}
              className="dsh-ssh-btn-primary"
            >
              {submitting ? '创建中...' : '创建工作区'}
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

function GlobalModalHost() {
  const [isOpen, setIsOpen] = useState(false)
  useEffect(() => {
    openModalGlobal = () => setIsOpen(true)
  }, [])
  return <AddRemoteModal isOpen={isOpen} onClose={() => setIsOpen(false)} />
}

function initSidebarButton() {
  if (!document.getElementById('dsh-ssh-styles')) {
    const style = document.createElement('style')
    style.id = 'dsh-ssh-styles'
    style.textContent = `
      [class*="headerActions"] {
        max-width: none !important;
        overflow: visible !important;
      }
      .dsh-ssh-header-btn {
        width: 28px;
        height: 28px;
        border-radius: 50%;
        border: none;
        background: transparent;
        color: var(--dsw-alias-label-secondary);
        cursor: pointer;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        padding: 0;
        margin: 0;
        transition: background-color 0.15s, color 0.15s;
      }
      .dsh-ssh-header-btn:hover {
        background: var(--dsw-alias-interactive-bg-hover);
        color: var(--dsw-alias-label-primary);
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
        width: 480px;
        max-width: min(520px, 92vw);
        background: var(--dsw-alias-bg-base) !important;
        color: var(--dsw-alias-label-primary) !important;
        border-radius: 12px;
        border: .5px solid var(--dsw-alias-border-l3) !important;
        box-shadow: var(--dsw-elevation-prominent, var(--dsw-shadow-lv3, 0 16px 36px rgba(0, 0, 0, 0.3)));
        overflow: hidden;
        display: flex;
        flex-direction: column;
        box-sizing: border-box;
        font-family: var(--dsw-font-family, inherit);
      }
      .dsh-ssh-modal-header {
        padding: 14px 18px;
        border-bottom: .5px solid var(--dsw-alias-border-l4);
        display: flex;
        align-items: center;
        justify-content: space-between;
        background: var(--dsw-alias-bg-layer-1);
      }
      .dsh-ssh-modal-title {
        font-weight: 600;
        font-size: 14px;
        color: var(--dsw-alias-label-primary);
        display: flex;
        align-items: center;
        gap: 8px;
      }
      .dsh-ssh-modal-close {
        background: transparent;
        border: none;
        color: var(--dsw-alias-label-secondary);
        cursor: pointer;
        width: 26px;
        height: 26px;
        border-radius: 6px;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 0;
        transition: background-color 0.15s ease;
      }
      .dsh-ssh-modal-close:hover {
        background: var(--dsw-alias-interactive-bg-hover);
        color: var(--dsw-alias-label-primary);
      }
      .dsh-ssh-label {
        display: block;
        font-size: 13px;
        font-weight: 500;
        color: var(--dsw-alias-label-primary) !important;
        margin-bottom: 6px;
      }
      .dsh-ssh-input, .dsh-ssh-select {
        width: 100%;
        height: 34px;
        padding: 0 10px;
        border-radius: 8px;
        border: .5px solid var(--dsw-alias-border-l4) !important;
        background: var(--dsw-alias-bg-layer-1) !important;
        color: var(--dsw-alias-label-primary) !important;
        font-size: 13px;
        box-sizing: border-box;
        outline: none;
        transition: border-color 0.15s ease;
      }
      .dsh-ssh-input:focus, .dsh-ssh-select:focus {
        border-color: var(--dsw-alias-brand-primary) !important;
      }
      .dsh-ssh-input::placeholder {
        color: var(--dsw-alias-label-dimmed) !important;
      }
      .dsh-ssh-select option {
        background: var(--dsw-alias-bg-base) !important;
        color: var(--dsw-alias-label-primary) !important;
      }
      .dsh-ssh-btn-secondary {
        height: 34px;
        padding: 0 14px;
        border-radius: 8px;
        border: .5px solid var(--dsw-alias-border-l4) !important;
        background: var(--dsw-alias-bg-layer-1) !important;
        color: var(--dsw-alias-label-primary) !important;
        font-size: 13px;
        font-weight: 500;
        cursor: pointer;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        transition: background-color 0.15s ease;
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
      }
      .dsh-ssh-btn-primary:hover:not(:disabled) {
        background: var(--dsw-alias-button-primary-hover) !important;
      }
      .dsh-ssh-btn-primary:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }
    `
    document.head.appendChild(style)
  }

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

    const headerActions = document.querySelector('[class*="headerActions"]')
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
