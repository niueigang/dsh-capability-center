# 建仓清单 · 你只需要给我 3 个东西

仓库内容、工作流、安装脚本、截图、License 都已经在本地备好（`git init` 已做，还没 push）。
下面三样只有你能提供，给了就能发。

## 必填

| # | 需要什么 | 用在哪 | 例子 |
| --- | --- | --- | --- |
| 1 | **GitHub 账号或组织名** | README 徽章、`install.ps1` 的下载地址、`package.json` 的 repository/homepage/bugs、LICENSE 署名 | `leigang` |
| 2 | **仓库名**（不给就用 `dsh-capability-center`） | 同上 | `dsh-capability-center` |
| 3 | **推送方式**（二选一） | 把本地提交推上去 | 见下 |

推送二选一：

- **A. 给我一个 PAT**（fine-grained token，勾 `Contents: Read and write`，只对这一个仓库授权）。
  我用它 `git push`，用完你随时在 GitHub 上撤销。token 不要写进任何文件。
- **B. 你自己推**。我把命令给你，你粘到 PowerShell 里跑：

  ```powershell
  cd C:\Users\Administrator\Desktop\sh\dsh-plugin-manager\deliverable\dsh-capability-center
  git remote add origin https://github.com/<你的账号>/dsh-capability-center.git
  git push -u origin main
  git push origin v0.1.0
  ```

  推 tag 会触发 `release` 工作流，自动打 zip 并建 Release。

## 可选

| # | 项 | 不提供的默认 |
| --- | --- | --- |
| 4 | **License 署名**（真名 / handle / 公司名） | 用 GitHub 账号名，`Copyright (c) 2026 <账号>` |
| 5 | **是否发 npm** | 不发。发的话给我一个 `npm publish` token，我补 `npm publish --access public` |
| 6 | **仓库可见性** | Public（私有仓库的 raw 链接带 token，`irm ... | iex` 那种一行安装会失效） |
| 7 | **截图是否换掉** | 用现在这三张（真机截图，1440×960） |

## 拿到 1、2 之后我会做的

```powershell
cd C:\Users\Administrator\Desktop\sh\dsh-plugin-manager\deliverable\dsh-capability-center
node tools/stamp.mjs <账号> [仓库名]      # 把 niueigang 占位符全换掉
git add -A
git commit -m "chore: stamp owner"
git tag -a v0.1.0 -m "v0.1.0"
```

`stamp.mjs` 会改这些地方，跑完 `git diff` 一眼就能核对：

- `README.md` —— 徽章链接、克隆地址、一行安装地址
- `install.ps1` / `install.cmd` —— 默认下载源 `codeload.github.com/<账号>/<仓库>`
- `LICENSE` —— 版权署名
- `package.json` —— `repository` / `homepage` / `bugs` / `author`
- `.github/workflows/release.yml` —— Release 说明里的安装地址

## 发出去之后，别人怎么装

三种都在 README 里：

1. **应用内**：DSH → 插件 → 添加插件 → 粘贴 `https://github.com/<账号>/<仓库>`
2. **一行**：`irm https://raw.githubusercontent.com/<账号>/<仓库>/main/install.ps1 | iex`
3. **Release zip**：下载 → 解压 → `node tools/install.mjs desktop`

## 我这边已经替你挡掉的坑

- **仓库根 = 包根**：`package.json` 在根目录，`pnpm add <git-url>` 才能直接认出来
- **`exports` 里有 `./locale/*.json`**：少了这条，宿主读不到 `locale/zh.json` 的 `meta.title`，
  「组合包」页会显示成 `Capability Center` 而不是「能力中心」（已实测踩过）
- **`dsh.bundle.patch` + `dsh.client.platform=web`** 必须都在，缺一个装上也看不见
- **没有构建产物要提交**：`lib/client.js` 是手写 bundle，git 里就是最终产物，CI 不需要 build
- **CI 会在 Node 20/22 上跑语法检查 + 冒烟测试 + 清单字段检查**，PR 挂不了
