# dsh-ssh

轻量级、零繁琐配置的 **DeepSeek Harness (DSH)** 远程开发插件。

基于本地已有的 `~/.ssh/config`，实现类似 **VS Code Remote-SSH** 的远程开发体验：
- 📂 **远程工作区**：在 DSH 中直接将远程目录添加为原生工作区；
- ⚡ **侧边栏透明拦截**：`dsh-better-sidebar` 的文件树、查看与保存（Ctrl+S）全部透明直达远端服务器；
- 💻 **内置终端直连**：在远程工作区打开侧栏终端，自动 `ssh -tt` 直连远端 Shell 环境；
- 🤖 **精炼 AI 工具**：专属工具（`remote_ssh_exec`、`remote_ssh_read`、`remote_ssh_write`、`remote_ssh_hosts`）仅按需注入远程工作区会话，普通本地工作区零污染、零干扰。

---

## 核心设计与优势

1. **零冗余配置**：无需在界面手动繁琐添加主机、端口和私钥，直接自动解析你本地的 `~/.ssh/config`（支持跳板机 ProxyJump、SSH Agent 和各类密钥认证）。
2. **零远程依赖**：远程服务器**无需安装 Node.js 或 DSH**，只要开启了普通的 `sshd` 即可。
3. **极简优雅**：利用 DSH WebServer 的 `exact` 路由优先级拦截 `better-sidebar` 原生文件路由，本地镜像路径与远程路径双向透明翻译，零修改第三方插件源码。
4. **长连接与缓存**：利用 OpenSSH 原生 `ControlMaster` 套接字复用与 5 秒 LRU 读缓存，文件浏览与命令调用均达到毫秒级响应。

---

## 安装与启用

> 💡 **关于密码登录支持**：
> 默认推荐配置公钥免密登录；若需使用账号密码登录（或主机配置了 `PasswordAuthentication yes`），本机需安装 `sshpass` 工具（如 Debian/Ubuntu 执行 `sudo apt install sshpass`，macOS 执行 `brew install hudochenkov/sshpass/sshpass`）。密码由浏览器原生密码管理器安全保存，插件后端仅在内存中暂存，绝不落盘。

```bash
# 从 GitHub 仓库安装
dsh plugin --profile web add github:abdecd/dsh-ssh
```

重启 DSH Web 即可生效：

```bash
dsh web
```

---

## 使用指南

1. 打开 Web 界面左侧齿轮 **设置 → 🖥️ 远程工作区**；
2. 页面会自动展示 `~/.ssh/config` 中的主机列表，可点击「测试连接」验证联通性；
3. 选择目标主机，填入远程项目绝对路径（如 `/root/code/my-app`），点击 **「🚀 创建远程工作区」**；
4. 切换到该远程工作区后：
   - 右侧「文件」标签页直接展示远程目录树，点击查看代码，按 `Ctrl+S` 保存时直接写回远程；
   - 右侧「终端」标签页自动进入远程 SSH 终端；
   - 聊天会话中，AI 自动感知该远程工作区，调用 `remote_ssh_exec` 等工具时自动在远端项目目录下执行。

---

## 许可证

MIT
