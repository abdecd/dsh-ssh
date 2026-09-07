// dsh-ssh client bundle
window.__ModuleLoader__.load({
  id: 'dsh-ssh',
  factory: function (require) {
    var module = { exports: {} };
    var exports = module.exports;
    var React = require('react');
    "use strict";
    var __create = Object.create;
    var __defProp = Object.defineProperty;
    var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
    var __getOwnPropNames = Object.getOwnPropertyNames;
    var __getProtoOf = Object.getPrototypeOf;
    var __hasOwnProp = Object.prototype.hasOwnProperty;
    var __export = (target, all) => {
      for (var name in all)
        __defProp(target, name, { get: all[name], enumerable: true });
    };
    var __copyProps = (to, from, except, desc) => {
      if (from && typeof from === "object" || typeof from === "function") {
        for (let key of __getOwnPropNames(from))
          if (!__hasOwnProp.call(to, key) && key !== except)
            __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
      }
      return to;
    };
    var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
      // If the importer is in node compatibility mode or this is not an ESM
      // file that has been converted to a CommonJS file using a Babel-
      // compatible transform (i.e. "__esModule" has not been set), then set
      // "default" to the CommonJS "module.exports" for node compatibility.
      isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
      mod
    ));
    var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

    // src/client/index.tsx
    var index_exports = {};
    __export(index_exports, {
      AddRemoteModal: () => AddRemoteModal,
      ReAuthModal: () => ReAuthModal,
      RemoteFolderBrowserModal: () => RemoteFolderBrowserModal,
      apply: () => apply,
      inject: () => inject
    });
    module.exports = __toCommonJS(index_exports);
    var import_react = require("react");
    var import_react_dom = __toESM(require("react-dom"), 1);
    var import_jsx_runtime = require("react/jsx-runtime");
    function RemoteFolderBrowserModal({
      isOpen,
      onClose,
      onSelect,
      host,
      initialPath,
      password
    }) {
      const initial = initialPath?.trim() || "~";
      const [currentPath, setCurrentPath] = (0, import_react.useState)(initial);
      const [inputPath, setInputPath] = (0, import_react.useState)(initial);
      const [folders, setFolders] = (0, import_react.useState)([]);
      const [loading, setLoading] = (0, import_react.useState)(false);
      const [errorMsg, setErrorMsg] = (0, import_react.useState)(null);
      const [truncated, setTruncated] = (0, import_react.useState)(false);
      const reqSeq = (0, import_react.useRef)(0);
      const loadDirectory = async (targetPath) => {
        if (!host) return;
        const reqId = ++reqSeq.current;
        setCurrentPath(targetPath);
        setInputPath(targetPath);
        setLoading(true);
        setErrorMsg(null);
        try {
          const res = await fetch("/dsh-ssh/api/browse", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              host,
              path: targetPath,
              password
            })
          }).then((r) => r.json());
          if (reqId !== reqSeq.current) return;
          if (res.ok) {
            const canonical = res.currentPath || targetPath;
            setCurrentPath(canonical);
            setInputPath(canonical);
            setFolders(res.dirs || []);
            setTruncated(Boolean(res.truncated));
          } else {
            setErrorMsg(res.error || "\u8BFB\u53D6\u76EE\u5F55\u5931\u8D25");
          }
        } catch (err) {
          if (reqId === reqSeq.current) {
            setErrorMsg(err?.message || "\u7F51\u7EDC\u8BF7\u6C42\u9519\u8BEF");
          }
        } finally {
          if (reqId === reqSeq.current) {
            setLoading(false);
          }
        }
      };
      (0, import_react.useEffect)(() => {
        if (isOpen && host) {
          const start = initialPath?.trim() || "~";
          setCurrentPath(start);
          setInputPath(start);
          setFolders([]);
          loadDirectory(start);
        }
      }, [isOpen, host, initialPath]);
      if (!isOpen) return null;
      const handleGoUp = () => {
        if (currentPath === "/" || !currentPath) return;
        const parts = currentPath.split("/").filter(Boolean);
        parts.pop();
        const parent = "/" + (parts.join("/") || "");
        const resolvedParent = parent === "//" ? "/" : parent;
        setCurrentPath(resolvedParent);
        setInputPath(resolvedParent);
        loadDirectory(resolvedParent);
      };
      const handleEnterFolder = (name) => {
        const next = currentPath === "/" ? `/${name}` : `${currentPath.replace(/\/+$/, "")}/${name}`;
        setCurrentPath(next);
        setInputPath(next);
        loadDirectory(next);
      };
      const handleFolderDoubleClick = (name) => {
        const next = currentPath === "/" ? `/${name}` : `${currentPath.replace(/\/+$/, "")}/${name}`;
        onSelect(next);
        onClose();
      };
      const handleInputSubmit = (e) => {
        e.preventDefault();
        if (inputPath.trim()) {
          const target = inputPath.trim();
          setCurrentPath(target);
          loadDirectory(target);
        }
      };
      const handleConfirm = () => {
        onSelect(currentPath);
        onClose();
      };
      return import_react_dom.default.createPortal(
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
          "div",
          {
            className: "dsh-ssh-modal-overlay",
            style: { zIndex: 1e6 },
            onClick: (e) => {
              if (e.target === e.currentTarget) onClose();
            },
            children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dsh-ssh-modal-card", style: { width: 560, maxWidth: "95vw" }, children: [
              /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dsh-ssh-modal-header", children: [
                /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dsh-ssh-modal-title", children: [
                  /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { style: { fontSize: "15px" }, children: "\u{1F4C2}" }),
                  /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { children: [
                    "\u9009\u62E9\u8FDC\u7A0B\u76EE\u5F55 (",
                    host,
                    ")"
                  ] })
                ] }),
                /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "button", className: "dsh-ssh-modal-close", onClick: onClose, title: "\u5173\u95ED", children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("svg", { width: "14", height: "14", viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: "2.2", strokeLinecap: "round", strokeLinejoin: "round", children: [
                  /* @__PURE__ */ (0, import_jsx_runtime.jsx)("line", { x1: "18", y1: "6", x2: "6", y2: "18" }),
                  /* @__PURE__ */ (0, import_jsx_runtime.jsx)("line", { x1: "6", y1: "6", x2: "18", y2: "18" })
                ] }) })
              ] }),
              /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: { padding: "12px 18px 8px", borderBottom: "1px solid var(--dsw-alias-border-l2)" }, children: [
                /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("form", { onSubmit: handleInputSubmit, style: { display: "flex", gap: "6px", alignItems: "center" }, children: [
                  /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
                    "button",
                    {
                      type: "button",
                      onClick: handleGoUp,
                      disabled: loading || currentPath === "/",
                      className: "dsh-ssh-btn-secondary",
                      title: "\u8FD4\u56DE\u4E0A\u4E00\u7EA7",
                      style: { height: 32, padding: "0 10px", fontSize: "12px", flexShrink: 0 },
                      children: "\u2B06 \u4E0A\u4E00\u7EA7"
                    }
                  ),
                  /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
                    "input",
                    {
                      type: "text",
                      value: inputPath,
                      onChange: (e) => setInputPath(e.target.value),
                      className: "dsh-ssh-input",
                      style: { height: 32, fontSize: "12px", flex: 1 },
                      placeholder: "\u8F93\u5165\u7EDD\u5BF9\u8DEF\u5F84\u6309\u56DE\u8F66\u524D\u5F80\uFF0C\u5982 /var/www"
                    }
                  ),
                  /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
                    "button",
                    {
                      type: "button",
                      onClick: () => loadDirectory(inputPath),
                      disabled: loading,
                      className: "dsh-ssh-btn-secondary",
                      title: "\u5237\u65B0",
                      style: { height: 32, padding: "0 10px", fontSize: "12px", flexShrink: 0 },
                      children: loading ? "..." : "\u524D\u5F80"
                    }
                  )
                ] }),
                truncated && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: { fontSize: "11px", color: "var(--dsw-alias-state-warning-primary, #b08800)", marginTop: 6 }, children: "\u26A0\uFE0F \u5F53\u524D\u76EE\u5F55\u5305\u542B\u8F83\u591A\u5B50\u6587\u4EF6\u5939\uFF0C\u5DF2\u9650\u5236\u5C55\u793A\u524D 200 \u9879\u3002" })
              ] }),
              /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: { height: 280, overflowY: "auto", padding: "6px 12px" }, children: [
                loading && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: { display: "flex", alignItems: "center", justifyContent: "center", height: "100%", color: "var(--dsw-alias-label-tertiary)", fontSize: "13px" }, children: "\u6B63\u5728\u62C9\u53D6\u8FDC\u7A0B\u76EE\u5F55..." }),
                !loading && errorMsg && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: { padding: "24px 16px", textAlign: "center" }, children: [
                  /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: { color: "var(--dsw-alias-state-error-primary, #cf222e)", fontSize: "13px", marginBottom: 12 }, children: errorMsg }),
                  /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
                    "button",
                    {
                      type: "button",
                      onClick: () => loadDirectory(currentPath),
                      className: "dsh-ssh-btn-secondary",
                      style: { height: 30, fontSize: "12px" },
                      children: "\u91CD\u8BD5"
                    }
                  )
                ] }),
                !loading && !errorMsg && folders.length === 0 && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: { display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100%", color: "var(--dsw-alias-label-tertiary)", fontSize: "13px" }, children: [
                  /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: { fontSize: 24, marginBottom: 6 }, children: "\u{1F4C1}" }),
                  /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { children: "(\u5F53\u524D\u76EE\u5F55\u4E0B\u65E0\u5B50\u6587\u4EF6\u5939)" }),
                  /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: { fontSize: 11, marginTop: 4, opacity: 0.8 }, children: "\u53EF\u4EE5\u76F4\u63A5\u70B9\u51FB\u4E0B\u65B9\u300C\u9009\u62E9\u5F53\u524D\u76EE\u5F55\u300D" })
                ] }),
                !loading && !errorMsg && folders.length > 0 && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: { display: "flex", flexDirection: "column", gap: "2px" }, children: folders.map((name) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(
                  "div",
                  {
                    className: "dsh-ssh-folder-item",
                    onClick: () => handleEnterFolder(name),
                    onDoubleClick: () => handleFolderDoubleClick(name),
                    title: `\u70B9\u51FB\u8FDB\u5165\u5E76\u66F4\u65B0\u8DEF\u5F84\uFF0C\u53CC\u51FB\u76F4\u63A5\u9009\u62E9: ${name}`,
                    children: [
                      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: { display: "flex", alignItems: "center", gap: "8px", overflow: "hidden" }, children: [
                        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { style: { fontSize: "14px", flexShrink: 0 }, children: "\u{1F4C1}" }),
                        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { style: { fontSize: "13px", textOverflow: "ellipsis", overflow: "hidden", whiteSpace: "nowrap" }, children: name })
                      ] }),
                      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { style: { fontSize: "12px", color: "var(--dsw-alias-label-tertiary)", flexShrink: 0 }, children: "\u8FDB\u5165 \u203A" })
                    ]
                  },
                  name
                )) })
              ] }),
              /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: {
                padding: "12px 18px",
                borderTop: "1px solid var(--dsw-alias-border-l2)",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                backgroundColor: "var(--dsw-alias-bg-module-platform)"
              }, children: [
                /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: { fontSize: "12px", color: "var(--dsw-alias-label-secondary)", maxWidth: 300, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }, children: [
                  "\u5DF2\u9009: ",
                  /* @__PURE__ */ (0, import_jsx_runtime.jsx)("strong", { style: { color: "var(--dsw-alias-label-primary)" }, children: currentPath })
                ] }),
                /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: { display: "flex", gap: "8px" }, children: [
                  /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "button", onClick: onClose, className: "dsh-ssh-btn-secondary", style: { height: 32, fontSize: "12px" }, children: "\u53D6\u6D88" }),
                  /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
                    "button",
                    {
                      type: "button",
                      onClick: handleConfirm,
                      className: "dsh-ssh-btn-primary",
                      style: { height: 32, fontSize: "12px" },
                      children: "\u2713 \u9009\u62E9\u6B64\u76EE\u5F55"
                    }
                  )
                ] })
              ] })
            ] })
          }
        ),
        document.body
      );
    }
    function AddRemoteModal({ isOpen, onClose }) {
      const [hosts, setHosts] = (0, import_react.useState)([]);
      const [selectedHost, setSelectedHost] = (0, import_react.useState)("");
      const [remotePath, setRemotePath] = (0, import_react.useState)("");
      const [title, setTitle] = (0, import_react.useState)("");
      const [password, setPassword] = (0, import_react.useState)("");
      const [submitting, setSubmitting] = (0, import_react.useState)(false);
      const [testing, setTesting] = (0, import_react.useState)(false);
      const [testResult, setTestResult] = (0, import_react.useState)(null);
      const [errorMsg, setErrorMsg] = (0, import_react.useState)(null);
      const [isBrowserOpen, setIsBrowserOpen] = (0, import_react.useState)(false);
      const currentHost = hosts.find((h) => h.host === selectedHost);
      const isPasswordAuth = Boolean(currentHost?.passwordAuthentication);
      const handleOpenBrowser = () => {
        if (!selectedHost) {
          setErrorMsg("\u8BF7\u5148\u9009\u62E9\u76EE\u6807\u4E3B\u673A");
          return;
        }
        if (isPasswordAuth && !password) {
          setErrorMsg("\u5F53\u524D\u4E3B\u673A\u914D\u7F6E\u4E3A\u5BC6\u7801\u767B\u5F55\uFF0C\u8BF7\u5148\u8F93\u5165 SSH \u767B\u5F55\u5BC6\u7801\u540E\u518D\u6D4F\u89C8\u76EE\u5F55");
          return;
        }
        setErrorMsg(null);
        setIsBrowserOpen(true);
      };
      const handleFolderSelect = (selectedPath) => {
        setRemotePath(selectedPath);
      };
      (0, import_react.useEffect)(() => {
        if (isOpen) {
          setErrorMsg(null);
          setTestResult(null);
          setPassword("");
          setRemotePath("");
          setTitle("");
          setIsBrowserOpen(false);
          fetch("/dsh-ssh/api/hosts").then((r) => r.json()).then((res) => {
            if (res.ok && res.hosts?.length > 0) {
              setHosts(res.hosts);
              setSelectedHost(res.hosts[0].host);
            }
          }).catch(() => {
          });
        }
      }, [isOpen]);
      if (!isOpen) return null;
      const handleHostChange = (newHost) => {
        setSelectedHost(newHost);
        setTestResult(null);
        setPassword("");
      };
      const handleTest = async () => {
        if (!selectedHost) return;
        setTesting(true);
        setTestResult(null);
        try {
          const res = await fetch("/dsh-ssh/api/test", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              host: selectedHost,
              password: isPasswordAuth ? password : void 0
            })
          }).then((r) => r.json());
          setTestResult({ ok: res.ok, msg: res.message || (res.ok ? "\u8FDE\u63A5\u6210\u529F" : "\u8FDE\u63A5\u5931\u8D25") });
        } catch (e) {
          setTestResult({ ok: false, msg: e?.message || "\u7F51\u7EDC\u8BF7\u6C42\u9519\u8BEF" });
        } finally {
          setTesting(false);
        }
      };
      const handleSubmit = async (e) => {
        e.preventDefault();
        if (!selectedHost || !remotePath.trim()) {
          setErrorMsg("\u8BF7\u9009\u62E9\u4E3B\u673A\u5E76\u586B\u5199\u8FDC\u7A0B\u9879\u76EE\u7EDD\u5BF9\u8DEF\u5F84");
          return;
        }
        if (isPasswordAuth && !password) {
          setErrorMsg("\u5F53\u524D\u4E3B\u673A\u914D\u7F6E\u4E3A\u5BC6\u7801\u767B\u5F55\uFF0C\u8BF7\u8F93\u5165 SSH \u767B\u5F55\u5BC6\u7801");
          return;
        }
        setSubmitting(true);
        setErrorMsg(null);
        try {
          const res = await fetch("/dsh-ssh/api/create-workspace", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              host: selectedHost,
              remotePath: remotePath.trim(),
              title: title.trim() || void 0,
              authType: isPasswordAuth ? "password" : "key",
              password: isPasswordAuth ? password : void 0
            })
          }).then((r) => r.json());
          if (res.ok) {
            onClose();
            window.location.reload();
          } else {
            setErrorMsg(res.error || "\u521B\u5EFA\u8FDC\u7A0B\u5DE5\u4F5C\u533A\u5931\u8D25");
          }
        } catch (err) {
          setErrorMsg(err?.message || "\u8BF7\u6C42\u9519\u8BEF");
        } finally {
          setSubmitting(false);
        }
      };
      return import_react_dom.default.createPortal(
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
            "div",
            {
              className: "dsh-ssh-modal-overlay",
              onClick: (e) => {
                if (e.target === e.currentTarget) onClose();
              },
              children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dsh-ssh-modal-card", children: [
                /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dsh-ssh-modal-header", children: [
                  /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dsh-ssh-modal-title", children: [
                    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("svg", { width: "16", height: "16", viewBox: "0 0 14 14", fill: "none", xmlns: "http://www.w3.org/2000/svg", children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("path", { fillRule: "evenodd", clipRule: "evenodd", d: "M7.00018 0.353516C10.6708 0.353535 13.6468 3.32958 13.6469 7.00018C13.6468 10.6708 10.6708 13.6468 7.00018 13.6469C3.32957 13.6468 0.353535 10.6708 0.353516 7.00018C0.353535 3.32957 3.32957 0.353531 7.00018 0.353516ZM5.44643 7.59661C5.49463 8.97506 5.70762 10.191 6.02136 11.0793C6.20141 11.5891 6.40328 11.9585 6.59898 12.1889C6.79501 12.4196 6.93213 12.454 7.00018 12.454C7.06822 12.454 7.20533 12.4197 7.40138 12.1889C7.59708 11.9585 7.79895 11.589 7.979 11.0793C8.29274 10.191 8.50574 8.97506 8.55394 7.59661H5.44643ZM1.57861 7.59661C1.80785 9.70467 3.2386 11.4509 5.1715 12.1388C5.07135 11.9317 4.97972 11.7098 4.89746 11.477C4.53084 10.4391 4.30224 9.0828 4.25357 7.59661H1.57861ZM9.74679 7.59661C9.69813 9.0828 9.46952 10.4391 9.1029 11.477C9.0206 11.7099 8.92818 11.9316 8.82797 12.1388C10.7613 11.4511 12.1925 9.70496 12.4218 7.59661H9.74679ZM5.1706 1.8616C3.23814 2.54963 1.80876 4.29604 1.5795 6.40376H4.25357C4.30224 4.91756 4.53083 3.56129 4.89746 2.5234C4.97968 2.29066 5.07051 2.0686 5.1706 1.8616ZM7.00018 1.54637C6.93213 1.54638 6.79503 1.5807 6.59898 1.81145C6.40332 2.04177 6.20139 2.41058 6.02136 2.92012C5.70754 3.80851 5.49461 5.02499 5.44643 6.40376H8.55394C8.50575 5.025 8.29282 3.80851 7.979 2.92012C7.79898 2.41059 7.59705 2.04177 7.40138 1.81145C7.20531 1.58067 7.06823 1.54637 7.00018 1.54637ZM8.82887 1.8616C8.92902 2.0687 9.02064 2.29053 9.1029 2.5234C9.46953 3.56129 9.69812 4.91756 9.74679 6.40376H12.4209C12.1916 4.29575 10.7618 2.54943 8.82887 1.8616Z", fill: "currentColor" }) }),
                    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: "\u6DFB\u52A0\u8FDC\u7A0B\u5DE5\u4F5C\u533A (SSH)" })
                  ] }),
                  /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
                    "button",
                    {
                      type: "button",
                      className: "dsh-ssh-modal-close",
                      onClick: onClose,
                      title: "\u5173\u95ED",
                      "aria-label": "\u5173\u95ED",
                      children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(
                        "svg",
                        {
                          width: "14",
                          height: "14",
                          viewBox: "0 0 24 24",
                          fill: "none",
                          stroke: "currentColor",
                          strokeWidth: "2.2",
                          strokeLinecap: "round",
                          strokeLinejoin: "round",
                          children: [
                            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("line", { x1: "18", y1: "6", x2: "6", y2: "18" }),
                            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("line", { x1: "6", y1: "6", x2: "18", y2: "18" })
                          ]
                        }
                      )
                    }
                  )
                ] }),
                /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("form", { onSubmit: handleSubmit, style: { padding: "20px 22px" }, children: [
                  /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
                    "input",
                    {
                      type: "text",
                      name: "username",
                      value: selectedHost,
                      readOnly: true,
                      tabIndex: -1,
                      autoComplete: "username",
                      style: { position: "absolute", opacity: 0, pointerEvents: "none", height: 0, width: 0 }
                    }
                  ),
                  errorMsg && /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
                    "div",
                    {
                      style: {
                        padding: "10px 14px",
                        borderRadius: "8px",
                        marginBottom: "16px",
                        fontSize: "13px",
                        backgroundColor: "rgba(248, 81, 73, 0.1)",
                        border: "1px solid rgba(248, 81, 73, 0.25)",
                        color: "var(--dsw-alias-state-error-primary, #cf222e)"
                      },
                      children: errorMsg
                    }
                  ),
                  /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: { marginBottom: "16px" }, children: [
                    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", { className: "dsh-ssh-label", children: [
                      "\u76EE\u6807\u4E3B\u673A ",
                      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { style: { fontWeight: "normal", color: "var(--dsw-alias-label-tertiary)" }, children: "(\u6765\u81EA ~/.ssh/config)" })
                    ] }),
                    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: { display: "flex", gap: "8px" }, children: [
                      /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
                        "select",
                        {
                          value: selectedHost,
                          onChange: (e) => handleHostChange(e.target.value),
                          className: "dsh-ssh-select",
                          style: { flex: 1 },
                          children: hosts.map((h) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("option", { value: h.host, children: [
                            h.host,
                            " ",
                            h.hostName ? `(${h.user || "user"}@${h.hostName})` : "",
                            h.passwordAuthentication ? " [\u5BC6\u7801\u767B\u5F55]" : ""
                          ] }, h.host))
                        }
                      ),
                      /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
                        "button",
                        {
                          type: "button",
                          onClick: handleTest,
                          disabled: testing,
                          className: "dsh-ssh-btn-secondary",
                          children: testing ? "\u6D4B\u8BD5\u4E2D..." : "\u6D4B\u8BD5\u8FDE\u63A5"
                        }
                      )
                    ] }),
                    isPasswordAuth && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: { marginTop: "12px" }, children: [
                      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", { className: "dsh-ssh-label", children: [
                        "SSH \u767B\u5F55\u5BC6\u7801 ",
                        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { style: { color: "var(--dsw-alias-state-error-primary, #cf222e)" }, children: "*" }),
                        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { style: { fontWeight: "normal", color: "var(--dsw-alias-label-tertiary)", marginLeft: 6 }, children: "(\u68C0\u6D4B\u5230 PasswordAuthentication\uFF0C\u5BC6\u7801\u7531\u6D4F\u89C8\u5668\u4FDD\u7BA1)" })
                      ] }),
                      /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
                        "input",
                        {
                          type: "password",
                          name: "password",
                          autoComplete: "current-password",
                          required: true,
                          className: "dsh-ssh-input",
                          placeholder: "\u8F93\u5165 SSH \u767B\u5F55\u5BC6\u7801\uFF08\u53EF\u88AB\u6D4F\u89C8\u5668\u4FDD\u5B58\uFF09",
                          value: password,
                          onChange: (e) => setPassword(e.target.value)
                        }
                      )
                    ] }),
                    testResult && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(
                      "div",
                      {
                        style: {
                          fontSize: "12px",
                          marginTop: "8px",
                          fontWeight: 500,
                          color: testResult.ok ? "var(--dsw-alias-state-success-primary, #1a7f37)" : "var(--dsw-alias-state-error-primary, #cf222e)"
                        },
                        children: [
                          testResult.ok ? "\u2713 " : "\u2715 ",
                          " ",
                          testResult.msg
                        ]
                      }
                    )
                  ] }),
                  /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: { marginBottom: "16px" }, children: [
                    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", { className: "dsh-ssh-label", children: [
                      "\u8FDC\u7A0B\u76EE\u5F55\u7EDD\u5BF9\u8DEF\u5F84 (Remote Path) ",
                      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { style: { color: "var(--dsw-alias-state-error-primary, #cf222e)" }, children: "*" })
                    ] }),
                    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: { display: "flex", gap: "8px" }, children: [
                      /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
                        "input",
                        {
                          type: "text",
                          required: true,
                          autoFocus: true,
                          className: "dsh-ssh-input",
                          placeholder: "\u4F8B\u5982: /root/code/my-app \u6216 /home/ubuntu/project",
                          value: remotePath,
                          onChange: (e) => setRemotePath(e.target.value),
                          style: { flex: 1 }
                        }
                      ),
                      /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
                        "button",
                        {
                          type: "button",
                          onClick: handleOpenBrowser,
                          className: "dsh-ssh-btn-secondary",
                          title: "\u6D4F\u89C8\u8FDC\u7A0B\u670D\u52A1\u5668\u76EE\u5F55",
                          style: { whiteSpace: "nowrap" },
                          children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: "\u6D4F\u89C8..." })
                        }
                      )
                    ] })
                  ] }),
                  /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: { marginBottom: "22px" }, children: [
                    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", { className: "dsh-ssh-label", children: [
                      "\u5DE5\u4F5C\u533A\u81EA\u5B9A\u4E49\u540D\u79F0 ",
                      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { style: { fontWeight: "normal", color: "var(--dsw-alias-label-tertiary)" }, children: "(\u53EF\u9009)" })
                    ] }),
                    /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
                      "input",
                      {
                        type: "text",
                        className: "dsh-ssh-input",
                        placeholder: "\u7559\u7A7A\u5219\u9ED8\u8BA4\u4F7F\u7528\u76EE\u5F55\u540D (\u5982: my-app)",
                        value: title,
                        onChange: (e) => setTitle(e.target.value)
                      }
                    )
                  ] }),
                  /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: { display: "flex", justifyContent: "flex-end", gap: "10px", paddingTop: "4px" }, children: [
                    /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
                      "button",
                      {
                        type: "button",
                        onClick: onClose,
                        className: "dsh-ssh-btn-secondary",
                        children: "\u53D6\u6D88"
                      }
                    ),
                    /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
                      "button",
                      {
                        type: "submit",
                        disabled: submitting || !remotePath.trim() || isPasswordAuth && !password,
                        className: "dsh-ssh-btn-primary",
                        children: submitting ? "\u521B\u5EFA\u4E2D..." : "\u521B\u5EFA\u5DE5\u4F5C\u533A"
                      }
                    )
                  ] })
                ] })
              ] })
            }
          ),
          isBrowserOpen && /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
            RemoteFolderBrowserModal,
            {
              isOpen: isBrowserOpen,
              onClose: () => setIsBrowserOpen(false),
              onSelect: handleFolderSelect,
              host: selectedHost,
              initialPath: remotePath.trim() || "~",
              password: isPasswordAuth ? password : void 0
            }
          )
        ] }),
        document.body
      );
    }
    function ReAuthModal({
      host,
      isOpen,
      onClose,
      onSuccess
    }) {
      const [rePassword, setRePassword] = (0, import_react.useState)("");
      const [submitting, setSubmitting] = (0, import_react.useState)(false);
      const [errorMsg, setErrorMsg] = (0, import_react.useState)(null);
      (0, import_react.useEffect)(() => {
        if (isOpen) {
          setErrorMsg(null);
          setRePassword("");
        }
      }, [isOpen]);
      if (!isOpen || !host) return null;
      const handleSubmit = async (e) => {
        e.preventDefault();
        if (!rePassword) return;
        setSubmitting(true);
        setErrorMsg(null);
        try {
          const res = await fetch("/dsh-ssh/api/auth-submit", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ host, password: rePassword })
          }).then((r) => r.json());
          if (res.ok) {
            onSuccess?.();
            onClose();
          } else {
            setErrorMsg(res.error || "\u8BA4\u8BC1\u5931\u8D25\uFF0C\u8BF7\u68C0\u67E5\u5BC6\u7801");
          }
        } catch (err) {
          setErrorMsg(err?.message || "\u7F51\u7EDC\u8BF7\u6C42\u9519\u8BEF");
        } finally {
          setSubmitting(false);
        }
      };
      return import_react_dom.default.createPortal(
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
          "div",
          {
            className: "dsh-ssh-modal-overlay",
            onClick: (e) => {
              if (e.target === e.currentTarget) onClose();
            },
            children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dsh-ssh-modal-card", style: { width: 440 }, children: [
              /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dsh-ssh-modal-header", children: [
                /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "dsh-ssh-modal-title", children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: "\u{1F510} \u91CD\u65B0\u8F93\u5165\u8FDC\u7A0B\u5BC6\u7801" }) }),
                /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "button", className: "dsh-ssh-modal-close", onClick: onClose, title: "\u5173\u95ED", children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(
                  "svg",
                  {
                    width: "14",
                    height: "14",
                    viewBox: "0 0 24 24",
                    fill: "none",
                    stroke: "currentColor",
                    strokeWidth: "2.2",
                    strokeLinecap: "round",
                    strokeLinejoin: "round",
                    children: [
                      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("line", { x1: "18", y1: "6", x2: "6", y2: "18" }),
                      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("line", { x1: "6", y1: "6", x2: "18", y2: "18" })
                    ]
                  }
                ) })
              ] }),
              /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("form", { onSubmit: handleSubmit, style: { padding: "20px 22px" }, children: [
                /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
                  "input",
                  {
                    type: "text",
                    name: "username",
                    value: host,
                    readOnly: true,
                    tabIndex: -1,
                    autoComplete: "username",
                    style: { position: "absolute", opacity: 0, pointerEvents: "none", height: 0, width: 0 }
                  }
                ),
                /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: { marginBottom: "14px", fontSize: "13px", lineHeight: "20px", color: "var(--dsw-alias-label-secondary)" }, children: [
                  "\u4E3B\u673A ",
                  /* @__PURE__ */ (0, import_jsx_runtime.jsx)("strong", { style: { color: "var(--dsw-alias-label-primary)" }, children: host }),
                  " \u7684\u8FDE\u63A5\u9700\u5BC6\u7801\u9A8C\u8BC1\uFF08\u6216\u6B64\u524D\u5185\u5B58\u4E2D\u7684\u5BC6\u7801\u5DF2\u8FC7\u671F\uFF09\u3002 \u82E5\u6D4F\u89C8\u5668\u5DF2\u4FDD\u5B58\u5BC6\u7801\u5DF2\u4E3A\u4F60\u81EA\u52A8\u586B\u5145\uFF0C\u786E\u8BA4\u5373\u53EF\u6062\u590D\u8FDE\u63A5\u3002"
                ] }),
                errorMsg && /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
                  "div",
                  {
                    style: {
                      padding: "10px 14px",
                      borderRadius: "8px",
                      marginBottom: "16px",
                      fontSize: "13px",
                      backgroundColor: "rgba(248, 81, 73, 0.1)",
                      border: "1px solid rgba(248, 81, 73, 0.25)",
                      color: "var(--dsw-alias-state-error-primary, #cf222e)"
                    },
                    children: errorMsg
                  }
                ),
                /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: { marginBottom: "20px" }, children: [
                  /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", { className: "dsh-ssh-label", children: [
                    "SSH \u767B\u5F55\u5BC6\u7801 ",
                    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { style: { color: "var(--dsw-alias-state-error-primary, #cf222e)" }, children: "*" })
                  ] }),
                  /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
                    "input",
                    {
                      type: "password",
                      name: "password",
                      autoComplete: "current-password",
                      autoFocus: true,
                      required: true,
                      className: "dsh-ssh-input",
                      placeholder: "\u8F93\u5165\u6216\u786E\u8BA4\u5BC6\u7801",
                      value: rePassword,
                      onChange: (e) => setRePassword(e.target.value)
                    }
                  )
                ] }),
                /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: { display: "flex", justifyContent: "flex-end", gap: "10px" }, children: [
                  /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "button", onClick: onClose, className: "dsh-ssh-btn-secondary", children: "\u53D6\u6D88" }),
                  /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "submit", disabled: submitting || !rePassword, className: "dsh-ssh-btn-primary", children: submitting ? "\u9A8C\u8BC1\u4E2D..." : "\u786E\u8BA4\u5E76\u8FDE\u63A5" })
                ] })
              ] })
            ] })
          }
        ),
        document.body
      );
    }
    var openModalGlobal = () => {
    };
    var openReAuthGlobal = () => {
    };
    function GlobalModalHost() {
      const [isOpen, setIsOpen] = (0, import_react.useState)(false);
      const [reAuthHost, setReAuthHost] = (0, import_react.useState)(null);
      (0, import_react.useEffect)(() => {
        openModalGlobal = () => setIsOpen(true);
        openReAuthGlobal = (h) => setReAuthHost(h);
      }, []);
      return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(AddRemoteModal, { isOpen, onClose: () => setIsOpen(false) }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
          ReAuthModal,
          {
            host: reAuthHost || "",
            isOpen: Boolean(reAuthHost),
            onClose: () => setReAuthHost(null),
            onSuccess: () => {
              setReAuthHost(null);
              window.dispatchEvent(new CustomEvent("dsh-ssh-reauth-success", { detail: { host: reAuthHost } }));
            }
          }
        )
      ] });
    }
    function initSidebarButton() {
      if (typeof window !== "undefined" && !window.__dsh_ssh_fetch_hooked__) {
        ;
        window.__dsh_ssh_fetch_hooked__ = true;
        const origFetch = window.fetch;
        window.fetch = async function(input, init) {
          const res = await origFetch.call(this, input, init);
          const url = typeof input === "string" ? input : input && typeof input === "object" && "url" in input ? input.url : String(input || "");
          if (url.includes("/sidebar/api/fs") || url.includes("/dsh-ssh/api/")) {
            if (res.status === 401) {
              try {
                const clone = res.clone();
                const data = await clone.json();
                if (data && data.needAuth && data.host) {
                  openReAuthGlobal(data.host);
                }
              } catch {
              }
            }
          }
          return res;
        };
      }
      let style = document.getElementById("dsh-ssh-styles");
      if (!style) {
        style = document.createElement("style");
        style.id = "dsh-ssh-styles";
        document.head.appendChild(style);
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
            width: 480px;
            max-width: min(520px, 92vw);
            background: var(--dsw-alias-bg-base) !important;
            border: 1px solid var(--dsw-alias-border-l1) !important;
            border-radius: 12px;
            box-shadow: var(--dsw-elevation-modal, 0 16px 36px rgba(0, 0, 0, 0.28));
            overflow: hidden;
            color: var(--dsw-alias-label-primary);
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
        `;
      let modalHost = document.getElementById("dsh-ssh-modal-host");
      if (!modalHost) {
        modalHost = document.createElement("div");
        modalHost.id = "dsh-ssh-modal-host";
        document.body.appendChild(modalHost);
        import_react_dom.default.render(/* @__PURE__ */ (0, import_jsx_runtime.jsx)(GlobalModalHost, {}), modalHost);
      }
      const tryInjectButton = () => {
        if (document.getElementById("dsh-ssh-add-remote-btn")) return;
        const headerActions = document.querySelector('[class*="sectionHeader"] [class*="headerActions"]') || document.querySelector('[class*="headerActions"]');
        if (!headerActions) return;
        const nativeAddBtn = document.querySelector('button[aria-label="\u6DFB\u52A0\u5DE5\u4F5C\u533A"], button[aria-label="Add workspace"], button[aria-label*="\u5DE5\u4F5C\u533A"]') || headerActions.querySelector("button:last-child");
        const btn = document.createElement("button");
        btn.id = "dsh-ssh-add-remote-btn";
        btn.type = "button";
        btn.className = "dsh-ssh-header-btn";
        btn.setAttribute("aria-label", "\u6DFB\u52A0\u8FDC\u7A0B\u5DE5\u4F5C\u533A");
        btn.title = "\u6DFB\u52A0\u8FDC\u7A0B\u5DE5\u4F5C\u533A (SSH)";
        btn.innerHTML = `
          <svg width="15" height="15" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path fill-rule="evenodd" clip-rule="evenodd" d="M7.00018 0.353516C10.6708 0.353535 13.6468 3.32958 13.6469 7.00018C13.6468 10.6708 10.6708 13.6468 7.00018 13.6469C3.32957 13.6468 0.353535 10.6708 0.353516 7.00018C0.353535 3.32957 3.32957 0.353531 7.00018 0.353516ZM5.44643 7.59661C5.49463 8.97506 5.70762 10.191 6.02136 11.0793C6.20141 11.5891 6.40328 11.9585 6.59898 12.1889C6.79501 12.4196 6.93213 12.454 7.00018 12.454C7.06822 12.454 7.20533 12.4197 7.40138 12.1889C7.59708 11.9585 7.79895 11.589 7.979 11.0793C8.29274 10.191 8.50574 8.97506 8.55394 7.59661H5.44643ZM1.57861 7.59661C1.80785 9.70467 3.2386 11.4509 5.1715 12.1388C5.07135 11.9317 4.97972 11.7098 4.89746 11.477C4.53084 10.4391 4.30224 9.0828 4.25357 7.59661H1.57861ZM9.74679 7.59661C9.69813 9.0828 9.46952 10.4391 9.1029 11.477C9.0206 11.7099 8.92818 11.9316 8.82797 12.1388C10.7613 11.4511 12.1925 9.70496 12.4218 7.59661H9.74679ZM5.1706 1.8616C3.23814 2.54963 1.80876 4.29604 1.5795 6.40376H4.25357C4.30224 4.91756 4.53083 3.56129 4.89746 2.5234C4.97968 2.29066 5.07051 2.0686 5.1706 1.8616ZM7.00018 1.54637C6.93213 1.54638 6.79503 1.5807 6.59898 1.81145C6.40332 2.04177 6.20139 2.41058 6.02136 2.92012C5.70754 3.80851 5.49461 5.02499 5.44643 6.40376H8.55394C8.50575 5.025 8.29282 3.80851 7.979 2.92012C7.79898 2.41059 7.59705 2.04177 7.40138 1.81145C7.20531 1.58067 7.06823 1.54637 7.00018 1.54637ZM8.82887 1.8616C8.92902 2.0687 9.02064 2.29053 9.1029 2.5234C9.46953 3.56129 9.69812 4.91756 9.74679 6.40376H12.4209C12.1916 4.29575 10.7618 2.54943 8.82887 1.8616Z" fill="currentColor"/>
          </svg>
        `;
        btn.onclick = (e) => {
          e.stopPropagation();
          openModalGlobal();
        };
        if (nativeAddBtn && nativeAddBtn.parentElement === headerActions) {
          headerActions.insertBefore(btn, nativeAddBtn);
        } else {
          headerActions.appendChild(btn);
        }
      };
      setInterval(tryInjectButton, 1e3);
      const observer = new MutationObserver(tryInjectButton);
      observer.observe(document.body, { childList: true, subtree: true });
    }
    var inject = ["slots"];
    function apply(_ctx) {
      if (typeof window !== "undefined" && typeof document !== "undefined") {
        initSidebarButton();
      }
    }

    return module.exports;
  }
});
