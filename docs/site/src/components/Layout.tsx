import { NavLink, Outlet } from 'react-router-dom';
import { BRAND, NAV_ITEMS } from '../nav';

export default function Layout() {
  return (
    <div className="min-h-screen flex flex-col">
      <header className="sticky top-0 z-20 bg-white/90 backdrop-blur border-b border-slate-200">
        <div className="max-w-6xl mx-auto px-4 sm:px-6">
          <div className="flex items-center justify-between h-14">
            <NavLink to="/" className="flex items-center gap-2 font-semibold text-slate-900">
              <span className="inline-flex h-7 w-7 items-center justify-center rounded-md bg-brand-600 text-white text-sm font-bold">dsh</span>
              <span className="hidden sm:inline">{BRAND.name}</span>
            </NavLink>
            <nav className="flex items-center gap-1 overflow-x-auto">
              {NAV_ITEMS.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.to === '/'}
                  className={({ isActive }) =>
                    `whitespace-nowrap px-3 py-2 rounded-md text-sm transition-colors ${
                      isActive ? 'bg-brand-50 text-brand-700 font-medium' : 'text-slate-600 hover:bg-slate-100'
                    }`
                  }
                >
                  {item.title}
                </NavLink>
              ))}
            </nav>
          </div>
        </div>
      </header>

      <main className="flex-1 bg-slate-50">
        <Outlet />
      </main>

      <footer className="border-t border-slate-200 bg-white">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8 text-sm text-slate-500">
          <div className="grid gap-6 sm:grid-cols-3">
            <div>
              <div className="font-semibold text-slate-900 mb-2">{BRAND.name}</div>
              <p>{BRAND.zh}</p>
            </div>
            <div>
              <div className="font-semibold text-slate-900 mb-2">官方渠道</div>
              <ul className="space-y-1">
                <li><a className="text-brand-600" href={BRAND.repo}>GitHub 仓库</a></li>
                <li><a className="text-brand-600" href="https://www.npmjs.com/package/dsh-lark-bot">npm：{BRAND.npm}</a></li>
              </ul>
            </div>
            <div>
              <div className="font-semibold text-slate-900 mb-2">提示</div>
              <p className="text-amber-700">本项目从不提供 .exe 或“下载即运行”安装包；凡以项目名义分发 exe 的渠道均为假冒来源。</p>
            </div>
          </div>
          <div className="mt-6 pt-4 border-t border-slate-200 flex flex-wrap gap-x-6 gap-y-2 justify-between">
            <span>AGPL-3.0 · 可自托管 · 个人/内部使用免费</span>
            <span>v0.19.13</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
