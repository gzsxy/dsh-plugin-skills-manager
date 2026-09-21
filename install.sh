#!/usr/bin/env bash
# 安装 dsh-plugin-skills-manager 到 DSH desktop profile
#
# ⚠️ 安全流程（2026-09-21 事故复盘后加入）：
#   1) 必须在 DSH Desktop 完全退出后执行（运行中改 profile 会导致启动挂起）
#   2) 使用 file: 拷贝安装，安装内容即本目录快照
#   3) 自动备份 profile 的 package.json / pnpm-lock.yaml
#   4) 安装后自动校验；可用 uninstall.sh 完整回滚
set -euo pipefail

PLUGIN_DIR="$(cd "$(dirname "$0")" && pwd)"
PROFILE_DIR="${DSH_PROFILE_DIR:-$HOME/.dsh/profiles/desktop}"   # 覆盖变量仅供测试彩排使用
PKG_NAME="dsh-plugin-skills-manager"

# 0) DSH 必须已退出
if pgrep -f "DSH Desktop.app" >/dev/null 2>&1; then
  echo "❌ 检测到 DSH Desktop 正在运行。"
  echo "   请先完全退出 DSH Desktop（菜单栏图标 → 退出，或 ⌘Q），再重新运行本脚本。"
  echo "   （在 DSH 运行时修改 profile 是上次启动事故的根因，本脚本已强制阻止）"
  exit 1
fi
echo "✓ 已确认 DSH Desktop 未在运行"

# 1) 找 Desktop 托管的 pnpm（DSH_PNPM_BIN 覆盖变量仅供测试彩排使用）
PNPM="${DSH_PNPM_BIN:-$(ls -t "$HOME/Library/Application Support/DSH Desktop/runtime-commands/generations/"*/bin/pnpm 2>/dev/null | head -1 || true)}"
[ -n "${PNPM:-}" ] && [ -x "$PNPM" ] || PNPM="$(command -v pnpm || true)"
[ -n "${PNPM:-}" ] || { echo "❌ 找不到 pnpm"; exit 1; }
echo "▸ 使用 pnpm: $PNPM"

[ -d "$PROFILE_DIR" ] || { echo "❌ 找不到 profile 目录: $PROFILE_DIR"; exit 1; }

# 2) 备份
TS=$(date +%Y%m%d-%H%M%S)
cp "$PROFILE_DIR/package.json" "$PROFILE_DIR/package.json.bak-$TS"
cp "$PROFILE_DIR/pnpm-lock.yaml" "$PROFILE_DIR/pnpm-lock.yaml.bak-$TS" 2>/dev/null || true
echo "▸ 已备份 package.json / pnpm-lock.yaml（后缀 .bak-${TS}）"

# 3) 自动递增 patch 版本（pnpm 对 file: 依赖按版本判断是否更新，
#    版本不变会跳过文件刷新——2026-09-21 排查结论），并预清理旧拷贝
python3 - "$PLUGIN_DIR/package.json" <<'EOF'
import json, sys
p = sys.argv[1]
d = json.load(open(p, encoding="utf-8"))
v = d.get("version", "0.0.0").split(".")
v = (v + ["0", "0"])[:3]
v[2] = str(int(v[2] or 0) + 1)
d["version"] = ".".join(v)
json.dump(d, open(p, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
print(f"▸ 版本已递增 → {d['version']}")
EOF
rm -rf "$PROFILE_DIR/node_modules/$PKG_NAME" 2>/dev/null || true

# 4) 安装（file: 拷贝）
cd "$PROFILE_DIR"
"$PNPM" add "file:$PLUGIN_DIR"

# 4) 登记 dsh.profile.bundles（幂等）
python3 - "$PROFILE_DIR/package.json" "$PKG_NAME" <<'EOF'
import json, sys
path, name = sys.argv[1], sys.argv[2]
d = json.load(open(path, encoding="utf-8"))
bundles = d.setdefault("dsh", {}).setdefault("profile", {}).setdefault("bundles", [])
if name not in bundles:
    bundles.append(name)
    json.dump(d, open(path, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
    print(f"▸ 已在 bundles 登记 {name}")
else:
    print(f"▸ bundles 中已存在 {name}，跳过")
EOF

# 5) 可选：NO_CLIENT 标记 → 纯服务端模式（排查界面问题时用）
if [ -f "$PLUGIN_DIR/NO_CLIENT" ]; then
  python3 - "$PROFILE_DIR/node_modules/$PKG_NAME" <<'EOF'
import json, sys, os
base = sys.argv[1]
open(os.path.join(base, "client.js"), "w", encoding="utf-8").close()
p = os.path.join(base, "package.json")
d = json.load(open(p, encoding="utf-8"))
d.get("dsh", {}).pop("client", None)
json.dump(d, open(p, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
print("▸ NO_CLIENT 模式：已禁用浏览器端（纯服务端）")
EOF
fi

# 6) 校验
[ -f "$PROFILE_DIR/node_modules/$PKG_NAME/package.json" ] || { echo "❌ 安装校验失败：node_modules 中未找到插件"; exit 1; }
python3 - "$PROFILE_DIR/package.json" "$PROFILE_DIR/node_modules/$PKG_NAME" "$PLUGIN_DIR/package.json" "$PLUGIN_DIR/NO_CLIENT" <<'EOF'
import json, os, sys
profile, base, src, noclient_marker = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4]
no_client = os.path.exists(noclient_marker)
d = json.load(open(profile, encoding="utf-8"))
assert "dsh-plugin-skills-manager" in d["dependencies"], "依赖未登记"
assert "dsh-plugin-skills-manager" in d["dsh"]["profile"]["bundles"], "bundles 未登记"
print("✓ 安装校验通过：依赖 + bundles 均已登记")
inst = json.load(open(os.path.join(base, "package.json"), encoding="utf-8"))
source = json.load(open(src, encoding="utf-8"))
assert inst["version"] == source["version"], f"版本不一致：装的是 {inst['version']}，源码是 {source['version']}（pnpm 未刷新！）"
cjs = os.path.join(base, "client.js")
size = os.path.getsize(cjs) if os.path.exists(cjs) else 0
if no_client:
    print(f"✓ 纯服务端模式：client.js {size} 字节，版本 {inst['version']}")
else:
    assert size > 0, "client.js 为空但源码含客户端（拷贝失败）"
    assert "client" in inst.get("dsh", {}), "已装 manifest 缺少 dsh.client"
    print(f"✓ 客户端已装入：client.js {size} 字节，版本 {inst['version']}")
EOF

echo ""
echo "✅ 安装完成。现在启动 DSH Desktop，然后："
echo "   • 界面 → 设置 → 「技能管理台」"
echo "   • 或访问 /api/skills-manager/dashboard（含技能市场）"
echo "   ⏳ 提示：装新插件后的第一次启动要为界面构建客户端包，可能比平时慢"
echo "      （1-2 分钟内属正常），请耐心等待窗口完全出现。"
echo "   若仍无法启动：touch $PLUGIN_DIR/NO_CLIENT 后重跑本脚本（纯服务端模式）"
echo "   卸载：bash uninstall.sh"
