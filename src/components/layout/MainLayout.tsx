import { ReactNode, useEffect, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { Header } from './Header'
import { Sidebar } from './Sidebar'

interface MainLayoutProps {
  children: ReactNode
}

export function MainLayout({ children }: MainLayoutProps) {
  const location = useLocation()
  // The drawer remembers the page it was opened on, so navigating closes it
  const [navOpenedOn, setNavOpenedOn] = useState<string | null>(null)
  const isNavOpen = navOpenedOn === location.pathname
  const setIsNavOpen = (open: boolean) => setNavOpenedOn(open ? location.pathname : null)

  // Lock page scroll and allow Escape while the drawer is open
  useEffect(() => {
    if (!isNavOpen) return
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setNavOpenedOn(null)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      document.body.style.overflow = previousOverflow
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [isNavOpen])

  return (
    <div className="min-h-screen bg-background">
      <Header isNavOpen={isNavOpen} onMenuClick={() => setIsNavOpen(!isNavOpen)} />
      <div className="flex">
        {/* Desktop: permanent sidebar */}
        <Sidebar className="hidden md:flex sticky top-12 h-[calc(100vh-3rem)]" />

        {/* Phone/tablet: slide-in drawer */}
        {isNavOpen && (
          <div className="fixed inset-0 top-12 z-40 md:hidden">
            <button
              type="button"
              aria-label="Close menu"
              className="absolute inset-0 bg-black/40 backdrop-blur-[1px] animate-in fade-in-0"
              onClick={() => setIsNavOpen(false)}
            />
            <Sidebar className="relative flex h-full w-64 max-w-[80vw] shadow-xl animate-in slide-in-from-left duration-200" />
          </div>
        )}

        {/* min-w-0 lets charts shrink inside the flex row instead of overflowing */}
        <main className="flex-1 min-w-0 p-3 sm:p-4 bg-grid min-h-[calc(100vh-3rem)]">
          {children}
        </main>
      </div>
    </div>
  )
}
