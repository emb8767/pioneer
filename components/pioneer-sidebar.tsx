'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarTrigger,
} from '@/components/ui/sidebar';
import { Separator } from '@/components/ui/separator';

// ════════════════════════════════════════
// TYPES
// ════════════════════════════════════════

interface BusinessInfo {
  business_type?: string;
  location?: string;
  phone?: string;
  hours?: string;
}

interface SessionData {
  sessionId: string;
  businessName: string | null;
  businessInfo: BusinessInfo | null;
  email: string | null;
}

// ════════════════════════════════════════
// ICONS (inline SVG)
// ════════════════════════════════════════

function SunIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="5" /><line x1="12" y1="1" x2="12" y2="3" /><line x1="12" y1="21" x2="12" y2="23" /><line x1="4.22" y1="4.22" x2="5.64" y2="5.64" /><line x1="18.36" y1="18.36" x2="19.78" y2="19.78" /><line x1="1" y1="12" x2="3" y2="12" /><line x1="21" y1="12" x2="23" y2="12" /><line x1="4.22" y1="19.78" x2="5.64" y2="18.36" /><line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
    </svg>
  );
}

function MessageSquareIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  );
}

function BuildingIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="4" y="2" width="16" height="20" rx="2" ry="2" /><path d="M9 22v-4h6v4" /><path d="M8 6h.01" /><path d="M16 6h.01" /><path d="M8 10h.01" /><path d="M16 10h.01" /><path d="M8 14h.01" /><path d="M16 14h.01" />
    </svg>
  );
}

function LogOutIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><polyline points="16 17 21 12 16 7" /><line x1="21" y1="12" x2="9" y2="12" />
    </svg>
  );
}

function MapPinIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" /><circle cx="12" cy="10" r="3" />
    </svg>
  );
}

function PhoneIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
    </svg>
  );
}

function ClockIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" />
    </svg>
  );
}

// ════════════════════════════════════════
// DARK MODE TOGGLE
// ════════════════════════════════════════

function DarkModeToggle() {
  const [dark, setDark] = useState(false);

  useEffect(() => {
    const saved = localStorage.getItem('pioneer_dark_mode');
    if (saved === 'true') {
      document.documentElement.classList.add('dark');
      setDark(true);
    }
  }, []);

  const toggle = () => {
    const next = !dark;
    setDark(next);
    localStorage.setItem('pioneer_dark_mode', String(next));
    if (next) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  };

  return (
    <button
      onClick={toggle}
      className="flex items-center gap-2 w-full px-3 py-2 text-sm text-muted-foreground hover:text-foreground hover:bg-accent rounded-lg transition-colors"
    >
      {dark ? <SunIcon /> : <MoonIcon />}
      {dark ? 'Modo claro' : 'Modo oscuro'}
    </button>
  );
}

// ════════════════════════════════════════
// NAV ITEM
// ════════════════════════════════════════

function NavItem({
  icon,
  label,
  active,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  active?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-3 w-full px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-200 cursor-pointer ${
        active
          ? 'bg-[var(--pioneer-teal-bg)] text-[var(--pioneer-teal)] border border-[var(--pioneer-teal)]/20'
          : 'text-muted-foreground hover:text-foreground hover:bg-accent'
      }`}
    >
      {icon}
      {label}
    </button>
  );
}

// ════════════════════════════════════════
// PIONEER SIDEBAR
// ════════════════════════════════════════

export function PioneerSidebar() {
  const router = useRouter();
  const [sessionData, setSessionData] = useState<SessionData | null>(null);

  useEffect(() => {
    fetch('/api/chat/session')
      .then(res => res.json())
      .then(data => {
        if (data.exists) {
          setSessionData({
            sessionId: data.sessionId,
            businessName: data.businessName,
            businessInfo: data.businessInfo || null,
            email: data.email || null,
          });
        }
      })
      .catch(() => {});
  }, []);

  const handleLogout = async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } catch { /* continue */ }
    localStorage.removeItem('pioneer_session_id');
    localStorage.removeItem('pioneer_dark_mode');
    router.push('/login');
  };

  const initials = sessionData?.businessName
    ? sessionData.businessName.split(' ').map(w => w[0]).join('').substring(0, 2).toUpperCase()
    : 'P';

  return (
    <Sidebar>
      {/* ═══ HEADER — Brand ═══ */}
      <SidebarHeader className="p-4 pb-3">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl pioneer-gradient text-white text-sm font-bold shadow-sm">
            P
          </div>
          <div className="flex flex-col">
            <span className="text-sm font-bold text-foreground tracking-tight">Pioneer Agent</span>
            <span className="text-[11px] text-muted-foreground">Marketing con IA</span>
          </div>
        </div>
      </SidebarHeader>

      <div className="px-4"><Separator /></div>

      <SidebarContent className="px-3 py-3">

        {/* ═══ BUSINESS CARD ═══ */}
        {sessionData?.businessName && (
          <div className="mb-3 p-3 rounded-xl border border-border bg-card/50">
            <div className="flex items-center gap-3 mb-2">
              <div className="h-10 w-10 rounded-xl bg-[var(--pioneer-teal-bg)] border border-[var(--pioneer-teal)]/20 flex items-center justify-center text-[var(--pioneer-teal)] text-sm font-bold">
                {initials}
              </div>
              <div className="flex flex-col min-w-0">
                <span className="text-sm font-semibold text-foreground truncate">
                  {sessionData.businessName}
                </span>
                {sessionData.businessInfo?.business_type && (
                  <span className="text-[11px] text-muted-foreground truncate">
                    {sessionData.businessInfo.business_type}
                  </span>
                )}
              </div>
            </div>

            {/* Business details */}
            <div className="space-y-1 mt-2">
              {sessionData.businessInfo?.location && (
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <MapPinIcon />
                  <span className="truncate">{sessionData.businessInfo.location}</span>
                </div>
              )}
              {sessionData.businessInfo?.phone && (
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <PhoneIcon />
                  <span>{sessionData.businessInfo.phone}</span>
                </div>
              )}
              {sessionData.businessInfo?.hours && (
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <ClockIcon />
                  <span>{sessionData.businessInfo.hours}</span>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ═══ NAVIGATION ═══ */}
        <div className="space-y-1">
          <NavItem
            icon={<MessageSquareIcon />}
            label="Chat"
            active={true}
            onClick={() => router.push('/chat')}
          />
          <NavItem
            icon={<BuildingIcon />}
            label="Perfil del negocio"
            onClick={() => router.push('/onboarding')}
          />
        </div>

      </SidebarContent>

      {/* ═══ FOOTER ═══ */}
      <SidebarFooter className="p-3 space-y-1">
        <div className="px-3"><Separator /></div>
        <DarkModeToggle />
        <button
          onClick={handleLogout}
          className="flex items-center gap-2 w-full px-3 py-2 text-sm text-muted-foreground hover:text-destructive hover:bg-destructive/10 rounded-lg transition-colors"
        >
          <LogOutIcon />
          Cerrar sesión
        </button>
      </SidebarFooter>
    </Sidebar>
  );
}

// ════════════════════════════════════════
// EXPORT TRIGGER FOR MOBILE
// ════════════════════════════════════════

export { SidebarTrigger as PioneerSidebarTrigger };
