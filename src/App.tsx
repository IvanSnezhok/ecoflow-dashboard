import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { MainLayout } from './components/layout/MainLayout'
import Dashboard from './pages/Dashboard'
import DeviceDetail from './pages/DeviceDetail'
import Statistics from './pages/Statistics'
import Logs from './pages/Logs'
import Settings from './pages/Settings'
import { useDevices } from './hooks/useDevices'

// Component that loads devices globally
function DeviceLoader({ children }: { children: React.ReactNode }) {
  useDevices() // Fetch devices on app startup
  return <>{children}</>
}

function App() {
  return (
    <BrowserRouter>
      <DeviceLoader>
        <MainLayout>
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/device/:serialNumber" element={<DeviceDetail />} />
            <Route path="/statistics/:serialNumber" element={<Statistics />} />
            <Route path="/logs" element={<Logs />} />
            <Route path="/settings" element={<Settings />} />
          </Routes>
        </MainLayout>
      </DeviceLoader>
    </BrowserRouter>
  )
}

export default App
