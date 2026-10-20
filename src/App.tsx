import { lazy, Suspense } from 'react'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MainLayout } from './components/layout/MainLayout'
import { useDevices } from './hooks/useDevices'
import { AuthGate } from './components/auth/AuthGate'
import { usePanelAccess } from './hooks/usePanelAccess'

// Heavy charts and page-specific dependencies are loaded only for the route the
// operator opens, keeping the initial monitoring screen responsive on small hosts.
const Dashboard = lazy(() => import('./pages/Dashboard'))
const DeviceDetail = lazy(() => import('./pages/DeviceDetail'))
const Statistics = lazy(() => import('./pages/Statistics'))
const ErrorHistory = lazy(() => import('./pages/ErrorHistory'))
const Automation = lazy(() => import('./pages/Automation'))
const Logs = lazy(() => import('./pages/Logs'))
const Settings = lazy(() => import('./pages/Settings'))
const Resilience = lazy(() => import('./pages/Resilience'))

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 30000, gcTime: 5 * 60 * 1000, refetchOnWindowFocus: false, retry: 1 } },
})

function DeviceLoader({ children }: { children: React.ReactNode }) {
  useDevices()
  return <>{children}</>
}

/** A page the signed-in user may not open (a link from someone else, a bookmark) */
function Restricted({ allowed, children }: { allowed: (access: ReturnType<typeof usePanelAccess>) => boolean; children: React.ReactNode }) {
  const access = usePanelAccess()
  if (allowed(access)) return <>{children}</>
  return <div className="p-6 text-sm text-muted-foreground">This page is not shared with you. The panel owner can change your access.</div>
}

function PageFallback() {
  return <div className="p-6 text-xs font-mono text-muted-foreground">Loading module…</div>
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AuthGate>
          <DeviceLoader>
            <MainLayout>
              <Suspense fallback={<PageFallback />}>
                <Routes>
                  <Route path="/" element={<Dashboard />} />
                  <Route path="/device/:serialNumber" element={<DeviceDetail />} />
                  <Route path="/device/:serialNumber/errors" element={<ErrorHistory />} />
                  <Route path="/statistics/:serialNumber" element={<Statistics />} />
                  <Route path="/automation" element={<Restricted allowed={(access) => access.isOwner}><Automation /></Restricted>} />
                  <Route path="/resilience" element={<Restricted allowed={(access) => access.powerReserve}><Resilience /></Restricted>} />
                  <Route path="/logs" element={<Restricted allowed={(access) => access.isOwner}><Logs /></Restricted>} />
                  <Route path="/settings" element={<Settings />} />
                </Routes>
              </Suspense>
            </MainLayout>
          </DeviceLoader>
        </AuthGate>
      </BrowserRouter>
    </QueryClientProvider>
  )
}
export default App
