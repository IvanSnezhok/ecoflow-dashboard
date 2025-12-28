import { useState, useRef, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { ExternalLink, Youtube, BookOpen, Info, ChevronRight } from "lucide-react";
import { getErrorInfo, type ErrorType } from "@/utils/errorCodes";
import { cn } from "@/lib/utils";

interface ErrorTooltipProps {
  errorCode: number;
  errorType: ErrorType;
  children: React.ReactNode;
}

interface TooltipPosition {
  top: number;
  left: number;
  placement: "top" | "bottom";
}

export function ErrorTooltip({ errorCode, errorType, children }: ErrorTooltipProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [position, setPosition] = useState<TooltipPosition | null>(null);
  const triggerRef = useRef<HTMLDivElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);

  const info = getErrorInfo(errorType, errorCode);

  const calculatePosition = useCallback(() => {
    if (!triggerRef.current) return;

    const triggerRect = triggerRef.current.getBoundingClientRect();
    const tooltipWidth = 320; // w-80 = 20rem = 320px
    const tooltipHeight = 400; // approximate max height
    const padding = 8;

    // Calculate vertical position
    const spaceBelow = window.innerHeight - triggerRect.bottom;
    const spaceAbove = triggerRect.top;
    const placement: "top" | "bottom" = spaceBelow < tooltipHeight && spaceAbove > spaceBelow ? "top" : "bottom";

    // Calculate horizontal position - center on trigger, but keep within viewport
    let left = triggerRect.left + triggerRect.width / 2 - tooltipWidth / 2;

    // Ensure tooltip doesn't go off the left edge
    if (left < padding) {
      left = padding;
    }

    // Ensure tooltip doesn't go off the right edge
    if (left + tooltipWidth > window.innerWidth - padding) {
      left = window.innerWidth - tooltipWidth - padding;
    }

    // Calculate top position
    const top = placement === "bottom"
      ? triggerRect.bottom + padding
      : triggerRect.top - tooltipHeight - padding;

    setPosition({ top: Math.max(padding, top), left, placement });
  }, []);

  useEffect(() => {
    if (isOpen) {
      calculatePosition();
      // Recalculate on scroll or resize
      window.addEventListener("scroll", calculatePosition, true);
      window.addEventListener("resize", calculatePosition);
      return () => {
        window.removeEventListener("scroll", calculatePosition, true);
        window.removeEventListener("resize", calculatePosition);
      };
    }
  }, [isOpen, calculatePosition]);

  const tooltipContent = position && (
    <div
      ref={tooltipRef}
      style={{
        position: "fixed",
        top: position.top,
        left: position.left,
        zIndex: 9999,
      }}
      className={cn(
        "w-80 max-w-[calc(100vw-16px)]",
        "bg-popover border border-border rounded-xl shadow-2xl",
        "p-4 animate-in fade-in-0 zoom-in-95 duration-200"
      )}
      onMouseEnter={() => setIsOpen(true)}
      onMouseLeave={() => setIsOpen(false)}
    >
      {/* Header */}
      <div className="flex items-start gap-3 mb-3">
        <div className="p-2 rounded-lg bg-red-500/10 shrink-0">
          <span className="text-red-500 font-mono font-bold text-sm">
            {typeof info.code === "string" ? info.code : `#${info.code}`}
          </span>
        </div>
        <div className="min-w-0">
          <h4 className="font-semibold text-foreground">{info.title}</h4>
          <p className="text-sm text-muted-foreground mt-0.5">{info.description}</p>
        </div>
      </div>

      {/* Causes */}
      <div className="mb-3">
        <h5 className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-1.5">
          Possible Causes
        </h5>
        <ul className="space-y-1">
          {info.causes.map((cause, i) => (
            <li key={i} className="flex items-start gap-2 text-sm">
              <ChevronRight className="w-3.5 h-3.5 text-muted-foreground shrink-0 mt-0.5" />
              <span>{cause}</span>
            </li>
          ))}
        </ul>
      </div>

      {/* Solutions */}
      <div className="mb-3">
        <h5 className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-1.5">
          Solutions
        </h5>
        <ul className="space-y-1">
          {info.solutions.map((solution, i) => (
            <li key={i} className="flex items-start gap-2 text-sm text-green-600 dark:text-green-400">
              <ChevronRight className="w-3.5 h-3.5 shrink-0 mt-0.5" />
              <span>{solution}</span>
            </li>
          ))}
        </ul>
      </div>

      {/* Links */}
      {(info.youtubeUrl || info.docsUrl) && (
        <div className="flex flex-wrap gap-2 pt-3 border-t border-border">
          {info.youtubeUrl && (
            <a
              href={info.youtubeUrl}
              target="_blank"
              rel="noopener noreferrer"
              className={cn(
                "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm",
                "bg-red-500/10 text-red-600 dark:text-red-400",
                "hover:bg-red-500/20 transition-colors"
              )}
              onClick={(e) => e.stopPropagation()}
            >
              <Youtube className="w-4 h-4" />
              Watch Videos
              <ExternalLink className="w-3 h-3" />
            </a>
          )}
          {info.docsUrl && (
            <a
              href={info.docsUrl}
              target="_blank"
              rel="noopener noreferrer"
              className={cn(
                "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm",
                "bg-blue-500/10 text-blue-600 dark:text-blue-400",
                "hover:bg-blue-500/20 transition-colors"
              )}
              onClick={(e) => e.stopPropagation()}
            >
              <BookOpen className="w-4 h-4" />
              Documentation
              <ExternalLink className="w-3 h-3" />
            </a>
          )}
        </div>
      )}
    </div>
  );

  return (
    <>
      <div
        ref={triggerRef}
        className="inline-block"
        onMouseEnter={() => setIsOpen(true)}
        onMouseLeave={() => setIsOpen(false)}
      >
        <div className="cursor-help flex items-center gap-1">
          {children}
          <Info className="w-3.5 h-3.5 text-muted-foreground opacity-60" />
        </div>
      </div>

      {/* Render tooltip in portal */}
      {isOpen && createPortal(tooltipContent, document.body)}
    </>
  );
}
