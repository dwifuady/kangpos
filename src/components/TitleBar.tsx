// Frameless window title bar (auto-hides like Larik's): sidebar toggle, active
// tab summary, window controls.
import { getCurrentWindow } from '@tauri-apps/api/window';
import { useEffect, useRef, useState } from 'react';
import { PanelLeft } from 'lucide-react';
import { activeEnvironment, useAppStore } from '../store';
import { tabTitle } from '../utils/request';
import { METHOD_COLORS } from '../utils/format';

interface TitleBarProps {
  sidebarWidth: number;
  sidebarHidden: boolean;
  onToggleSidebar: () => void;
}

const HIDE_DELAY = 1200;

export function TitleBar({ sidebarWidth, sidebarHidden, onToggleSidebar }: TitleBarProps) {
  const [isMaximized, setIsMaximized] = useState(false);
  const [visible, setVisible] = useState(true);
  const hideTimer = useRef<number | null>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const appWindow = getCurrentWindow();

  const tab = useAppStore(s => s.tabs.find(t => t.id === s.activeTabId) ?? null);
  const env = useAppStore(s => activeEnvironment(s));

  const reveal = () => {
    if (hideTimer.current) window.clearTimeout(hideTimer.current);
    hideTimer.current = null;
    setVisible(true);
  };
  const scheduleHide = () => {
    if (hideTimer.current) window.clearTimeout(hideTimer.current);
    hideTimer.current = window.setTimeout(() => setVisible(false), HIDE_DELAY);
  };

  // Reveal when the cursor touches the top edge of the window.
  useEffect(() => {
    let raf: number | null = null;
    const onMove = (e: MouseEvent) => {
      if (raf !== null) return;
      raf = window.requestAnimationFrame(() => {
        raf = null;
        if (e.clientY <= 4) reveal();
        else if (!barRef.current?.contains(e.target as Node) && !hideTimer.current) scheduleHide();
      });
    };
    window.addEventListener('mousemove', onMove);
    const initial = window.setTimeout(() => setVisible(false), 2500);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.clearTimeout(initial);
      if (raf !== null) window.cancelAnimationFrame(raf);
      if (hideTimer.current) window.clearTimeout(hideTimer.current);
    };
  }, []);

  useEffect(() => {
    const check = () => appWindow.isMaximized().then(setIsMaximized).catch(() => undefined);
    check();
    const unlisten = appWindow.onResized(check);
    return () => {
      unlisten.then(fn => fn()).catch(() => undefined);
    };
  }, [appWindow]);

  const toggleMaximize = async () => {
    await appWindow.toggleMaximize();
    setIsMaximized(await appWindow.isMaximized());
  };

  return (
    <div
      ref={barRef}
      className={`flex items-center h-8 select-none relative pointer-events-auto border-b border-[var(--border-subtle)] transition-[transform,opacity,box-shadow] duration-200 ease-[cubic-bezier(0.16,1,0.3,1)] ${
        visible ? 'translate-y-0 opacity-100 shadow-[0_4px_12px_rgba(0,0,0,0.18)]' : '-translate-y-full opacity-0 pointer-events-none'
      }`}
      style={{ background: 'var(--bg-secondary)' }}
      onMouseEnter={reveal}
      onMouseLeave={scheduleHide}
    >
      <div
        className="h-full flex items-center transition-all duration-300 ease-[cubic-bezier(0.4,0,0.2,1)]"
        style={{ width: sidebarHidden ? 'auto' : `${sidebarWidth}px`, paddingLeft: sidebarHidden ? 6 : 0 }}
      >
        <div className={`flex items-center h-full ${sidebarHidden ? '' : 'px-1.5'}`}>
          <button
            onClick={onToggleSidebar}
            className="w-7 h-7 rounded-md hover:bg-[var(--bg-hover)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] flex items-center justify-center"
            title="Toggle sidebar (Ctrl+B)"
          >
            <PanelLeft className="w-4 h-4" strokeWidth={1.5} />
          </button>
        </div>
      </div>

      <div data-tauri-drag-region className="flex-1 h-full min-w-0 flex items-center gap-1.5 px-2 pr-[146px]">
        {tab ? (
          <>
            <span className="text-[10px] font-bold" style={{ color: METHOD_COLORS[tab.request.method] }}>
              {tab.request.method}
            </span>
            <span className="text-[11px] font-medium text-[var(--text-primary)] truncate max-w-[280px]">{tabTitle(tab)}</span>
            <span className="text-[10px] text-[var(--text-muted)]">•</span>
            {env ? (
              <span className="text-[9px] font-medium px-1.5 py-0.5 rounded-full bg-blue-500/15 text-blue-400">{env.name}</span>
            ) : (
              <span className="text-[9px] font-medium px-1.5 py-0.5 rounded-full bg-[var(--bg-hover)] text-[var(--text-muted)]">
                No environment
              </span>
            )}
          </>
        ) : (
          <span className="text-[11px] font-medium text-[var(--text-muted)]">KangPos</span>
        )}
      </div>

      <div className="absolute right-0 top-0 h-full flex items-stretch">
        <button
          type="button"
          onClick={() => appWindow.minimize()}
          className="w-[46px] flex items-center justify-center text-[var(--text-primary)] hover:bg-[var(--bg-hover)]"
          aria-label="Minimize"
        >
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1"><path d="M0 5.5h10" /></svg>
        </button>
        <button
          type="button"
          onClick={toggleMaximize}
          className="w-[46px] flex items-center justify-center text-[var(--text-primary)] hover:bg-[var(--bg-hover)]"
          aria-label={isMaximized ? 'Restore' : 'Maximize'}
        >
          {isMaximized ? (
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1">
              <rect x="0.5" y="2.5" width="7" height="7" rx="1" />
              <path d="M2.5 2.5V1.5a1 1 0 0 1 1-1h5a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1h-1" />
            </svg>
          ) : (
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1">
              <rect x="0.5" y="0.5" width="9" height="9" rx="1.5" />
            </svg>
          )}
        </button>
        <button
          type="button"
          onClick={() => appWindow.close()}
          className="w-[46px] flex items-center justify-center text-[var(--text-primary)] hover:bg-[#c42b1c] hover:text-white"
          aria-label="Close"
        >
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1">
            <path d="M0.5 0.5l9 9M9.5 0.5l-9 9" />
          </svg>
        </button>
      </div>
    </div>
  );
}
