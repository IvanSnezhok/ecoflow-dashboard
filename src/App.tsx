import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MainLayout } from './components/layout/MainLayout'
import Dashboard from './pages/Dashboard'
import DeviceDetail from './pages/DeviceDetail'
import Statistics from './pages/Statistics'
import ErrorHistory from './pages/ErrorHistory'
import Automation from './pages/Automation'
import Logs from './pages/Logs'
import Settings from './pages/Settings'
import { useDevices } from './hooks/useDevices'

// React Query client with caching configuration
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30000, // 30 seconds
      gcTime: 5 * 60 * 1000, // 5 minutes (garbage collection time)
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
})

// Component that loads devices globally
function DeviceLoader({ children }: { children: React.ReactNode }) {
  useDevices() // Fetch devices on app startup
  return <>{children}</>
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <DeviceLoader>
          <MainLayout>
            <Routes>
              <Route path="/" element={<Dashboard />} />
              <Route path="/device/:serialNumber" element={<DeviceDetail />} />
              <Route path="/device/:serialNumber/errors" element={<ErrorHistory />} />
              <Route path="/statistics/:serialNumber" element={<Statistics />} />
              <Route path="/automation" element={<Automation />} />
              <Route path="/logs" element={<Logs />} />
              <Route path="/settings" element={<Settings />} />
            </Routes>
          </MainLayout>
        </DeviceLoader>
      </BrowserRouter>
    </QueryClientProvider>
  )
}

export default App
