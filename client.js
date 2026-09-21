// dsh-plugin-skills-manager — 浏览器端
// 功能：① 设置页「技能管理台」分区 ② 对话框旁 ⚡ 技能选择按钮（插入 /技能名）
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
        try { React = require('react'); } catch (e) { /* DOM 兜底 */ }

        let Panel;
        try {
          Panel = function SkillsManagerPanel() {
            if (React) {
              return React.createElement('iframe', {
                src: '/api/skills-manager/dashboard',
                title: 'Skills 管理台',
                style: { width: '100%', height: 'calc(100vh - 120px)', minHeight: '520px', border: '0', borderRadius: '12px', background: '#f6f7f9' },
              });
            }
            const el = document.createElement('iframe');
            el.src = '/api/skills-manager/dashboard';
            el.title = 'Skills 管理台';
            el.setAttribute('style', 'width:100%;height:calc(100vh - 120px);min-height:520px;border:0;border-radius:12px;background:#f6f7f9');
            return el;
          };
        } catch (e) {
          console.warn(`[${NS}] 构建面板失败:`, e);
          Panel = () => null;
        }

        // ---------- ⚡ 对话框旁技能选择按钮 ----------
        function SkillPickerButton() {
          const [open, setOpen] = React.useState(false);
          const [skills, setSkills] = React.useState(null);
          const [q, setQ] = React.useState('');
          const btnRef = React.useRef(null);
          const boxRef = React.useRef(null);

          React.useEffect(() => {
            function onDoc(e) {
              if (open && boxRef.current && !boxRef.current.contains(e.target) && btnRef.current && !btnRef.current.contains(e.target)) setOpen(false);
            }
            document.addEventListener('mousedown', onDoc);
            return () => document.removeEventListener('mousedown', onDoc);
          }, [open]);

          const load = () => {
            if (skills) return;
            fetch('/api/skills-manager/index', { cache: 'no-store' })
              .then(r => r.json())
              .then(d => setSkills((d.skills || []).slice().sort((a, b) => a.name.localeCompare(b.name))))
              .catch(() => setSkills([]));
          };

          function findComposerTextarea(fromEl) {
            let el = fromEl;
            while (el && el !== document.documentElement) {
              try {
                const card = el.querySelector('[data-composer-card]');
                if (card) { const ta = card.querySelector('textarea'); if (ta) return ta; }
              } catch (e) { /* ignore */ }
              el = el.parentElement;
            }
            const tas = [...document.querySelectorAll('textarea')].filter(t => !t.disabled && t.offsetParent !== null);
            return tas.length ? tas[tas.length - 1] : null;
          }
          function insert(name) {
            const text = '/' + name + ' ';
            const ta = findComposerTextarea(btnRef.current)
              || (document.querySelector('[data-composer-card]') && document.querySelector('[data-composer-card]').querySelector('textarea'))
              || document.querySelector('main textarea')
              || document.querySelector('textarea');
            if (ta) {
              try {
                const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
                const cur = ta.value || '';
                setter.call(ta, cur && cur.trim().length ? cur.replace(/\s*$/, '') + ' ' + text : text);
                ta.dispatchEvent(new Event('input', { bubbles: true }));
                ta.focus();
                try { ta.selectionStart = ta.selectionEnd = ta.value.length; } catch (e) { /* ignore */ }
              } catch (e) {
                try { navigator.clipboard.writeText(text); } catch (e2) { /* ignore */ }
              }
            } else {
              try { navigator.clipboard.writeText(text); } catch (e) { /* ignore */ }
            }
            setOpen(false);
          }

          const filtered = (skills || []).filter(s => {
            if (!q.trim()) return true;
            const t = (s.name + ' ' + (s.description_zh || '') + ' ' + (s.description || '')).toLowerCase();
            return t.includes(q.trim().toLowerCase());
          });

          return React.createElement('div', { style: { position: 'relative', display: 'inline-block' }, ref: btnRef },
            React.createElement('button', {
              type: 'button', title: '插入 /技能名 调用', onClick: () => { const n = !open; setOpen(n); if (n) load(); },
              style: { background: 'none', border: 'none', cursor: 'pointer', fontSize: '15px', padding: '2px 6px', lineHeight: 1 },
            }, '⚡'),
            open && React.createElement('div', {
              ref: boxRef,
              style: {
                position: 'fixed', left: '50%', transform: 'translateX(-50%)', bottom: '110px',
                width: 'min(560px, 92vw)', maxHeight: '46vh', overflow: 'auto', zIndex: 9999,
                background: '#fff', border: '1px solid #e6e8ee', borderRadius: '12px',
                boxShadow: '0 12px 40px rgba(0,0,0,.18)', padding: '10px', fontSize: '13px',
              },
            },
              React.createElement('div', { style: { display: 'flex', gap: '6px', marginBottom: '8px', position: 'sticky', top: 0, background: '#fff', paddingBottom: '6px' } },
                React.createElement('input', {
                  autoFocus: true, placeholder: '搜索技能后点击插入 /技能名…',
                  value: q, onChange: e => setQ(e.target.value),
                  style: { flex: 1, padding: '6px 10px', border: '1px solid #e6e8ee', borderRadius: '8px', outline: 'none', fontSize: '13px' },
                }),
                React.createElement('span', { style: { color: '#69707f', fontSize: '12px', alignSelf: 'center' } }, (skills ? skills.length + ' 个' : '加载中…')),
              ),
              skills === null
                ? React.createElement('div', { style: { color: '#69707f', padding: '10px' } }, '加载中…')
                : (filtered.length === 0
                  ? React.createElement('div', { style: { color: '#9aa1b0', padding: '10px' } }, '没有匹配的技能')
                  : filtered.map(s => React.createElement('div', {
                    key: s.folder,
                    onClick: () => insert(s.name),
                    style: { padding: '7px 10px', borderRadius: '8px', cursor: 'pointer', display: 'flex', gap: '8px', alignItems: 'baseline' },
                    onMouseEnter: e => { e.currentTarget.style.background = '#f0f4ff'; },
                    onMouseLeave: e => { e.currentTarget.style.background = ''; },
                  },
                    React.createElement('code', { style: { fontWeight: 600, fontSize: '12.5px' } }, '/' + s.name),
                    React.createElement('span', { style: { color: '#69707f', fontSize: '12px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 } },
                      (s.description_zh || s.description || '').slice(0, 60)))))),
          );
        }

        function apply(ctx) {
          try {
            const slots = ctx && ctx.slots;
            if (slots === void 0) {
              console.warn(`[${NS}] slots 服务不可用，跳过界面注册（仍可通过 /api/skills-manager/dashboard 访问）`);
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
            ctx.effect?.(
              () => slots.inject(
                'conversation.input.right',
                () => slots.register(
                  { name: 'conversation.input.right', id: 'sm-picker', order: 90, label: '技能' },
                  SkillPickerButton,
                ),
              ),
              `${NS}: composer picker`,
            );
          } catch (e) {
            console.warn(`[${NS}] 界面注册失败:`, e);
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
