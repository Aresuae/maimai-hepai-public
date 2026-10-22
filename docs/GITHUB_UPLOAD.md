# 上传 GitHub

仓库包含源码、配置示例、测试、文档及必要构建文件。账号授权、数据库、订单、临时邀请与运行产物保留在自己的电脑，不属于发布内容。

## 生成可上传版本

在项目根目录执行（只需要 Node.js，不依赖已安装的 node_modules）：

```bash
npm run github:export
```

输出位置：`artifacts/github/<时间戳>/`。

```text
maimai-hepai/              可作为仓库根目录的源码
maimai-hepai-source.zip    同一份源码的压缩包
manifest.json             文件数、字节数、逐文件 SHA-256 与压缩包摘要
```

每次创建新的输出目录，不覆盖旧包。脚本采用发布目录白名单、敏感路径排除、文本凭证检查，以及当前 `.env.local` 中敏感值的匹配检查；发现疑似凭证会停止且只报告文件名和规则，不输出值。它不会启动程序、请求官方接口或上传任何文件。

检查范围不等于能识别所有形式的秘密。新增截图或附件仍需人工确认没有 Token、真实订单支付链接、手机号或有效邀请二维码。源码包仅保留 `docs/images/` 中已审阅的测试截图。

`.openai/hosting.json` 是构建使用的空 D1/R2 绑定声明，应保留。不要漏传 `.openai/`、`.github/`、`.gitignore`、`.env.example` 和 `.npmrc` 等隐藏配置。

## 比赛材料完整性

根目录必须保留 `README.md`、`CONTEST_DECLARATION.md`、`MCP_INTEGRATION.md`、`mcp-config.example.json`，以及可运行源码。README 已列出目标用户和使用示例，MCP 文档已列出实际 Server、Tool、调用流程和业务价值。

`CONTEST_DECLARATION.md` 原样复制自 [官方固定版本](https://github.com/M-China/mcd-developer-innovation-challenge/blob/c51074fde6a12786b6fe76091aefbb69acdffd5b/CONTEST_DECLARATION.md)。其 SHA-256 为：

```text
cd28101bcb29cc8fb24b372fe91ce6b42c4a1487a54e01f7ade0c8c6a84241b7
```

打包时会检查必需文件和声明原文字节；缺失或被修改时停止导出。Git 使用 LF 保存 Markdown，避免 Windows 换行转换影响声明校验。声明的来源、版本与项目补充说明写在 README 中，不添加到声明正文。

申请 WorkBuddy 专项奖励时还需根目录 `workbuddy.md`，内容应来自实际 WorkBuddy 对话并脱敏。本仓库目前没有这项记录；不会生成虚假的使用证明。打包器支持在将来提供真实记录后纳入该文件。

正式参赛还需要仓库公开可访问，并按官方格式提交报名 Issue；上传源码不等于报名成功。完整规则以 [官方活动仓库](https://github.com/M-China/mcd-developer-innovation-challenge) 为准。

## 方式一：上传解压后的文件

1. 在 GitHub 创建自己的仓库，可使用 `maimai-hepai` 作为名称。
2. 解压 `maimai-hepai-source.zip`，进入其中的 `maimai-hepai/` 文件夹。
3. 将**该文件夹内的内容**放到仓库根目录，让根目录直接出现 `README.md`、`package.json`、`src/` 等；不要只上传 ZIP 文件作为源码。
4. 包含所有隐藏配置文件并提交。若浏览器选择文件不方便，使用下面的 Git 方式。

## 方式二：从源码包使用 Git 推送

先在 GitHub 建立一个空仓库，然后在解压后的 `maimai-hepai/` 目录运行：

```bash
git init -b main
git add .
git status --short
git commit -m "Initial release: 麦麦合拍"
git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPOSITORY.git
git push -u origin main
```

把 `YOUR_USERNAME` 和 `YOUR_REPOSITORY` 替换为自己的用户名、仓库名。登录由 Git/GitHub 的正常认证流程完成，不把访问 Token 写进远程地址。

这些命令用于**新解压、没有 Git 历史的目录**。如果仓库已有提交或远程关联，先检查现有历史与分支，再合并本次内容；不要强制推送覆盖它。打包脚本不会更改当前工作区的 Git 历史、暂存区或远程配置。

## 仓库展示建议

- 名称：`maimai-hepai`
- 简介：`麦麦合拍：基于麦当劳 MCP 的多人共享选餐原型，支持预算、邀请二维码、分批结算与官方支付交接。`
- Topics：`react`、`typescript`、`vite`、`sqlite`、`mcp`、`collaborative-ordering`
- 首页说明：使用根目录 README，能力边界及运行方式已写明。
- 开源许可证：当前尚未指定整体许可证，需要作者自行选择；保留随附第三方许可证。

## 自动检查与复现

仓库包含 `.github/workflows/ci.yml`，推送或提交 Pull Request 时执行依赖安装、类型检查、测试、两种构建和源码打包检查。CI 不使用麦当劳 Token，不启动公网通道，也不下单。

```bash
npm ci
npm run typecheck
npm test
npm run build
npm run share:build
npm run github:export
```

GitHub 仓库与应用部署是两件事。上传后，朋友仍需使用本机程序生成的邀请链接；GitHub Pages 不能承载这里的 Node、SQLite、账号与订单接口。如需固定域名和持续在线服务，需要另外部署并适配服务器的进程、HTTPS、会话和数据库管理。
