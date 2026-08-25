import { Route, Routes } from 'react-router-dom';
import Layout from './components/Layout';
import Home from './pages/Home';
import QuickStart from './pages/QuickStart';
import Features from './pages/Features';
import Commands from './pages/Commands';
import NotificationSinks from './pages/NotificationSinks';
import Configuration from './pages/Configuration';
import Security from './pages/Security';
import Troubleshooting from './pages/Troubleshooting';
import NotFound from './pages/NotFound';

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Home />} />
        <Route path="docs/quickstart" element={<QuickStart />} />
        <Route path="docs/features" element={<Features />} />
        <Route path="docs/commands" element={<Commands />} />
        <Route path="docs/notification-sinks" element={<NotificationSinks />} />
        <Route path="docs/configuration" element={<Configuration />} />
        <Route path="docs/security" element={<Security />} />
        <Route path="docs/troubleshooting" element={<Troubleshooting />} />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  );
}
