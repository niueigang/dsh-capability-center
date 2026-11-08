# 维护者笔记

仓库已经发在 <https://github.com/niueigang/dsh-capability-center>，这份文件是给以后改它的人看的。

## 当前状态

| 项 | 状态 |
| --- | --- |
| 仓库 | 公开，默认分支 `main`，带 6 个 topic |
| 分支 | `c50ec2f` 首个版本 · `fc7e5b9` 安装脚本编码修复 |
| 标签 | `v0.1.0` → `fc7e5b9` |
| Release | <https://github.com/niueigang/dsh-capability-center/releases/tag/v0.1.0>，附 `dsh-capability-center-v0.1.0.zip` |
| CI | **未入库**（见下） |

## 为什么 `.github/workflows/` 还没进仓库

推送时报过：

```
refusing to allow a Personal Access Token to create or update workflow
`.github/workflows/ci.yml` without `workflow` scope
```

classic PAT 只勾了 `repo`，缺 `workflow`。补法二选一：

**A. 改 token 权限（保留同一个 token 串）**

<https://github.com/settings/tokens> → 点开这个 token → 勾上 `workflow` → Update token。
然后把工作流提交推上去：

```powershell
cd C:\Users\Administrator\Desktop\sh\dsh-plugin-manager\deliverable\dsh-capability-center
git add .github/workflows
git commit -m "ci: 添加 GitHub Actions 工作流"
git -c http.proxy=socks5h://127.0.0.1:10808 push origin main
```

**B. 网页上加**

GitHub → Add file → Create new file → 路径填 `.github/workflows/ci.yml`，把本地同名文件内容整段粘进去；`release.yml` 同理。

两个工作流做的事：

- `ci.yml` —— Node 20/22 上跑 `node --check` + `node tools/check-manifest.mjs` + `node test/smoke.mjs`
- `release.yml` —— 推 `v*` 标签时跑同样的检查，打带目录前缀的 zip，建 Release 并附资产（现在的 Release 是手工建的，内容一样）

## 发一个新版本

```powershell
# 1. 改 package.json 的 version 和 CHANGELOG.md
# 2. 提交
git add -A
git commit -m "feat: xxx"
# 3. 打标签（annotated，别用轻量标签）
git tag -a v0.1.1 -m "v0.1.1"
# 4. 推（这台机器直连 github 不通，必须带代理）
git -c http.proxy=socks5h://127.0.0.1:10808 push origin main
git -c http.proxy=socks5h://127.0.0.1:10808 push origin v0.1.1
```

工作流入库后，第 4 步会顺带产出 Release；没入库时手动建：

```powershell
git archive --format=zip --prefix=dsh-capability-center/ -o pkg.zip HEAD
# GitHub → Releases → Draft a new release → 选标签 → 上传 pkg.zip
```

## 发 npm（可选）

现在没发。要发的话：

```powershell
npm login
npm publish --access public
```

`package.json` 的 `files` 已经写好（`lib` / `locale` / `cordis.patch.yml` / `tools` / `README.md` / `LICENSE`），
`publishConfig.access` 是 `public`。发完之后安装方式多一条：`dsh plugin --profile desktop add dsh-capability-center`。

## 本地自测

```powershell
node tools/check-manifest.mjs   # 宿主认不认这个包
node test/smoke.mjs             # 临时 DSH_HOME 造 3 个技能，跑开关/详情/错误分支
```

想看真界面：把 `tools/install.mjs` 指向一个测试 profile，起 `dsh --profile <name> --port 17777`，
浏览器打开它打印出来的 token 链接。

## 安全提醒

- **PAT 只放一次**：脚本用 `Read-Host -AsSecureString` 接，不写 `.git/config`、不落盘。
  推完就去 <https://github.com/settings/tokens> 撤掉；贴进过聊天记录的 token 一律当作已泄露。
- `install.ps1` 下载的是 `codeload.github.com` 的 zip，不依赖 `git clone`，所以终端用户不需要装 git。
- 安装脚本只改 profile 的三处（junction、dependencies、bundles），改前备份 `package.json`。
