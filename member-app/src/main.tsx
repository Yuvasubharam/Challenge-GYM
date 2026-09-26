import { StrictMode, Suspense, lazy } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import './index.css';
import Layout from './components/Layout';
import { PageLoader, ToastProvider } from './components/ui';
import { SessionProvider, useSession } from './lib/session';
import { HomeProvider } from './lib/home';
import { FitProvider } from './lib/fitctx';
import Welcome from './pages/Welcome';

const Home = lazy(() => import('./pages/Home'));
const Visits = lazy(() => import('./pages/Visits'));
const Diet = lazy(() => import('./pages/Diet'));
const Train = lazy(() => import('./pages/Train'));
const Progress = lazy(() => import('./pages/Progress'));
const PlanPage = lazy(() => import('./pages/Plan'));
const Profile = lazy(() => import('./pages/Profile'));
const Receipt = lazy(() => import('./pages/Receipt'));
const Shop = lazy(() => import('./pages/Shop'));
const Gallery = lazy(() => import('./pages/Gallery'));
const News = lazy(() => import('./pages/News'));

function Gate() {
  const { session, loading } = useSession();
  if (loading) return <PageLoader />;
  if (!session) return <Welcome />;
  return (
    <HomeProvider>
      <FitProvider>
      <Suspense fallback={<PageLoader />}>
        <Routes>
          <Route path="/receipt/:id" element={<Receipt />} />
          <Route element={<Layout />}>
            <Route index element={<Home />} />
            <Route path="diet" element={<Diet />} />
            <Route path="train" element={<Train />} />
            <Route path="progress" element={<Progress />} />
            <Route path="visits" element={<Visits />} />
            <Route path="plan" element={<PlanPage />} />
            <Route path="profile" element={<Profile />} />
            <Route path="shop" element={<Shop />} />
            <Route path="gallery" element={<Gallery />} />
            <Route path="gallery/:id" element={<Gallery />} />
            <Route path="news" element={<News />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </Suspense>
      </FitProvider>
    </HomeProvider>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <ToastProvider>
        <SessionProvider>
          <Gate />
        </SessionProvider>
      </ToastProvider>
    </BrowserRouter>
  </StrictMode>,
);

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => undefined));
}
