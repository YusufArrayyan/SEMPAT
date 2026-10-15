import '@fontsource/ibm-plex-sans/300.css'
import '@fontsource/ibm-plex-sans/400.css'
import '@fontsource/ibm-plex-sans/600.css'
import '@fontsource/ibm-plex-mono/400.css'
import 'maplibre-gl/dist/maplibre-gl.css'
import './styles.css'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { StrictMode, lazy, Suspense, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import Shell from './components/Shell'
import { Loading } from './components/ui'
import { ApiError } from './lib/api'
import { AuthProvider, useAuth } from './lib/auth'
import type { Role } from './lib/types'

const Login = lazy(() => import('./pages/Login'))
const Dashboard = lazy(() => import('./pages/Dashboard'))
const DataPage = lazy(() => import('./pages/DataPage'))
const DatasetDetail = lazy(() => import('./pages/DatasetDetail'))
const Scenarios = lazy(() => import('./pages/Scenarios'))
const ScenarioEditor = lazy(() => import('./pages/ScenarioEditor'))
const Results = lazy(() => import('./pages/Results'))
const Compare = lazy(() => import('./pages/Compare'))
const Methodology = lazy(() => import('./pages/Methodology'))
const Admin = lazy(() => import('./pages/Admin'))
const PublicView = lazy(() => import('./pages/PublicView'))
const NotFound = lazy(() => import('./pages/NotFound'))

const qc = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: (n, e) => !(e instanceof ApiError && e.status >= 400 && e.status < 500) && n < 2,
    },
  },
})

function RequireAuth({ children, role }: { children: ReactNode; role?: Role }) {
  const { user, loading, can } = useAuth()
  const loc = useLocation()
  if (loading)
    return (
      <div className="page">
        <Loading />
      </div>
    )
  if (!user) return <Navigate to={`/masuk?ke=${encodeURIComponent(loc.pathname + loc.search)}`} replace />
  if (role && !can(role)) return <Navigate to="/" replace />
  return <>{children}</>
}

const fallback = (
  <div className="page">
    <Loading />
  </div>
)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={qc}>
      <AuthProvider>
        <BrowserRouter>
          <Suspense fallback={fallback}>
            <Routes>
              <Route path="/masuk" element={<Login />} />
              <Route path="/publik/:token" element={<PublicView />} />
              <Route
                element={
                  <RequireAuth>
                    <Shell />
                  </RequireAuth>
                }
              >
                <Route index element={<Dashboard />} />
                <Route path="data" element={<DataPage />} />
                <Route path="data/:id" element={<DatasetDetail />} />
                <Route path="skenario" element={<Scenarios />} />
                <Route path="skenario/:id" element={<ScenarioEditor />} />
                <Route path="hasil/:id" element={<Results />} />
                <Route path="bandingkan" element={<Compare />} />
                <Route path="metodologi" element={<Methodology />} />
                <Route
                  path="admin"
                  element={
                    <RequireAuth role="admin">
                      <Admin />
                    </RequireAuth>
                  }
                />
                <Route path="*" element={<NotFound />} />
              </Route>
            </Routes>
          </Suspense>
        </BrowserRouter>
      </AuthProvider>
    </QueryClientProvider>
  </StrictMode>,
)
