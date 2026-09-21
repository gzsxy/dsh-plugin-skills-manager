#!/usr/bin/env bash
# 卸载 dsh-plugin-skills-manager（干净回滚，不影响其他插件）
# 用法: bash uninstall.sh
set -euo pipefail

PROFILE_DIR="$HOME/.dsh/profiles/desktop"
PKG_NAME="dsh-plugin-skills-manager"

PNPM="$(ls -t "$HOME/Library/Application Support/DSH Desktop/runtime-commands/generations/"*/bin/pnpm 2>/dev/null | head -1 || true)"
[ -n "${PNPM:-}" ] && [ -x "$PNPM" ] || PNPM="$(command -v pnpm || true)"
[ -n "${PNPM:-}" ] || { echo "❌ 找不到 pnpm"; exit 1; }

cd "$PROFILE_DIR"
"$PNPM" remove "$PKG_NAME" || echo "▸ pnpm remove 无匹配依赖，继续清理 bundles"

python3 - "$PROFILE_DIR/package.json" "$PKG_NAME" <<'EOF'
import json, sys
path, name = sys.argv[1], sys.argv[2]
d = json.load(open(path, encoding="utf-8"))
bundles = d.get("dsh", {}).get("profile", {}).get("bundles", [])
if name in bundles:
    bundles.remove(name)
    json.dump(d, open(path, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
    print(f"▸ 已从 bundles 移除 {name}")
else:
    print(f"▸ bundles 中不存在 {name}，跳过")
EOF

echo "✅ 卸载完成。重启 DSH Desktop 后生效。"
