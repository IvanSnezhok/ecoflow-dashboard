import { useState, type ReactNode } from 'react'
import { ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useSettingsStore } from '@/stores/settingsStore'

interface CollapsibleCardProps {
  /** Remembers the open/closed choice (settings store) */
  id: string
  icon: ReactNode
  title: string
  /** What the section holds, shown next to the title */
  hint?: string
  /** Once opened, stays mounted while closed (e.g. a check whose result should survive) */
  keepMounted?: boolean
  children: ReactNode
}

/**
 * A card for technical details that are not needed at a glance. Closed by default; the
 * content mounts only when open, so its queries do not run in the background.
 */
export function CollapsibleCard({ id, icon, title, hint, keepMounted, children }: CollapsibleCardProps) {
  const open = useSettingsStore((s) => s.openSections.includes(id))
  const toggleSection = useSettingsStore((s) => s.toggleSection)
  const [opened, setOpened] = useState(open)
  if (open && !opened) setOpened(true)
  const mounted = open || (keepMounted && opened)

  return (
    <section className="rounded-sm border bg-card overflow-hidden">
      <button
        type="button"
        onClick={() => toggleSection(id)}
        aria-expanded={open}
        className="w-full px-4 py-3 bg-muted/30 hover:bg-muted/50 transition-colors flex items-center gap-2 text-left"
      >
        {icon}
        <span className="text-xs font-semibold uppercase tracking-wider shrink-0">{title}</span>
        {hint && <span className="text-[10px] text-muted-foreground truncate">{hint}</span>}
        <ChevronDown className={cn('ml-auto w-4 h-4 shrink-0 text-muted-foreground transition-transform', open && 'rotate-180')} />
      </button>
      {mounted && <div className="border-t" hidden={!open}>{children}</div>}
    </section>
  )
}
