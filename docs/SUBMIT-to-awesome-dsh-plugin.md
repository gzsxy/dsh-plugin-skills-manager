# 提交到 awesome-dsh-plugin 插件列表

目标仓库：https://github.com/awesome-dsh-plugin/awesome-dsh-plugin
投稿方式：PR 添加 **一个文件** `data/plugins/gzsxy__dsh-plugin-skills-manager.yml`（内容见本目录 `awesome-dsh-plugin-entry.yml`，可直接复制）。

## 前置（一次性，在自己的仓库做）

1. **加 topic**：打开 https://github.com/gzsxy/dsh-plugin-skills-manager
   → 右侧栏 About 区域 → 点 ⚙️ 齿轮图标
   → Topics 框输入 `dsh-plugin` 回车（可再加 `dsh` `agent-skills`）
   → Save changes
2. **填 About 简介**（同一个编辑框里的 Description 欄）：
   `DSH Desktop 技能管理台：浏览/搜索/安装全部 Agent Skills，内置技能市场与更新检查`

## 提交 PR（约 3 分钟）

1. Fork：打开 https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/fork → Create fork
2. 在你的 fork 里：Add file → Create new file
3. 文件名输入：`data/plugins/gzsxy__dsh-plugin-skills-manager.yml`（输入 `/` 会自动创建目录）
4. 粘贴 `docs/../awesome-dsh-plugin-entry.yml` 的全部内容
5. Propose changes → Create pull request → 提交到 awesome-dsh-plugin/main

## 收录后

- CI 自动校验（manifest / 仓库年龄 / 格式）通过后**自动合并**，无需人工
- 合并后自动同步进 deepseek1024 等目录站点，两个 README 自动重新生成
- 注意：1024 Store 的「一键安装」要求包发布到 npm；未发布 npm 时条目仍会收录，只是显示为浏览（附仓库链接）

## 已达标的自查项

- [x] package.json 声明 `dsh.bundle.patch`（仅 `dsh.client` 会被拒——最常见的被拒原因）
- [x] cordis.patch.yml 已提交且在 exports 中可见
- [x] 仓库创建超过 1 天
- [x] 真实可用的代码（非占位仓库）
- [x] 描述与代码功能一致，无营销词
