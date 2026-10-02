import { StrictMode, Suspense, lazy } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import './index.css';
import Layout from './components/Layout';
import { PageLoader, ToastProvider } from './components/ui';
import { SessionProvider, useSession } from './lib/session';
import Login from './pages/Login';

const Dashboard = lazy(() => import('./pages/Dashboard'));
const Members = lazy(() => import('./pages/Members'));
const MemberDetail = lazy(() => import('./pages/MemberDetail'));
const Renewals = lazy(() => import('./pages/Renewals'));
const Payments = lazy(() => import('./pages/Payments'));
const Attendance = lazy(() => import('./pages/Attendance'));
const Device = lazy(() => import('./pages/Device'));
const Plans = lazy(() => import('./pages/Plans'));
const Fitness = lazy(() => import('./pages/Fitness'));
const Coupons = lazy(() => import('./pages/Coupons'));
const FeedbackPage = lazy(() => import('./pages/Feedback'));
const Content = lazy(() => import('./pages/Content'));
const SettingsPage = lazy(() => import('./pages/Settings'));
const Receipt = lazy(() => import('./pages/Receipt'));

function Gate() {
  const { session, loading } = useSession();
  if (loading) return <PageLoader />;
  if (!session) return <Login />;
  return (
    <Suspense fallback={<PageLoader />}>
      <Routes>
        <Route path="/receipt/:id" element={<Receipt />} />
        <Route element={<Layout />}>
          <Route index element={<Dashboard />} />
          <Route path="members" element={<Members />} />
          <Route path="members/:id" element={<MemberDetail />} />
          <Route path="renewals" element={<Renewals />} />
          <Route path="payments" element={<Payments />} />
          <Route path="attendance" element={<Attendance />} />
          <Route path="device" element={<Device />} />
          <Route path="plans" element={<Plans />} />
          <Route path="fitness" element={<Fitness />} />
          <Route path="coupons" element={<Coupons />} />
          <Route path="feedback" element={<FeedbackPage />} />
          <Route path="content" element={<Content />} />
          <Route path="settings" element={<SettingsPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </Suspense>
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
