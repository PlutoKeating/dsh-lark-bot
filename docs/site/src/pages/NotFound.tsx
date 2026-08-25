import { Link } from 'react-router-dom';
import PageShell from '../components/PageShell';

export default function NotFound() {
  return (
    <PageShell title="页面不存在" subtitle="404">
      <p>你访问的页面不存在或已被移动。</p>
      <p><Link className="text-brand-600" to="/">返回首页</Link>，或浏览 <Link className="text-brand-600" to="/docs/quickstart">快速开始</Link>。</p>
    </PageShell>
  );
}
