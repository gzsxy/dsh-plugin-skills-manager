// dsh-plugin-skills-manager — 浏览器端
// 在 DSH 设置页注册「技能管理台」分区（iframe 内嵌服务端 dashboard）。
// 设计原则：任何异常都被吞掉并仅打印 console 警告，绝不影响 DSH 界面本身启动；
// 若加载时 ModuleLoader 尚未就绪，自动重试等待（最多 30 秒）。
function __smRegister() {
  try {
    if (!window.__ModuleLoader__) return false;
    window.__ModuleLoader__.load({
      id: 'dsh-plugin-skills-manager',
      factory: (require) => {
        const module = { exports: {} };
        const NS = 'dsh-plugin-skills-manager';
        let React = null;
        try { React = require('react'); } catch (e) { /* 走 DOM 兜底 */ }

        let Panel;
        try {
          Panel = function SkillsManagerPanel() {
            if (React) {
              return React.createElement('iframe', {
                src: '/api/skills-manager/dashboard',
                title: 'Skills 管理台',
                style: {
                  width: '100%', height: 'calc(100vh - 170px)', minHeight: '480px',
                  border: '0', borderRadius: '12px', background: '#f6f7f9',
                },
              });
            }
            const el = document.createElement('iframe');
            el.src = '/api/skills-manager/dashboard';
            el.title = 'Skills 管理台';
            el.setAttribute('style', 'width:100%;height:calc(100vh - 170px);min-height:480px;border:0;border-radius:12px;background:#f6f7f9');
            return el;
          };
        } catch (e) {
          console.warn(`[${NS}] 构建面板失败:`, e);
          Panel = () => null;
        }

        function apply(ctx) {
          try {
            const slots = ctx && ctx.slots;
            if (slots === void 0) {
              console.warn(`[${NS}] slots 服务不可用，跳过设置页注册（仍可通过 /api/skills-manager/dashboard 访问）`);
              return;
            }
            ctx.effect?.(
              () => slots.inject(
                'settings.section',
                () => slots.register(
                  { name: 'settings.section', id: 'skills-manager', order: 36, label: '技能管理台' },
                  Panel,
                ),
              ),
              `${NS}: settings section`,
            );
          } catch (e) {
            console.warn(`[${NS}] 设置页注册失败:`, e);
          }
        }

        // cordis 契约：访问 ctx.slots 必须在模块导出中声明 inject
        // （缺失此声明会导致 "cannot get property slots without inject"）
        module.exports = { apply, inject: ["slots"] };
        return module.exports;
      },
    });
    return true;
  } catch (e) {
    console.warn('[dsh-plugin-skills-manager] client 加载失败（不影响 DSH 使用）:', e);
    return true; // 已尝试，不再重试
  }
}
if (!__smRegister()) {
  const __smTimer = setInterval(() => { if (__smRegister()) clearInterval(__smTimer); }, 100);
  setTimeout(() => clearInterval(__smTimer), 30000);
}
