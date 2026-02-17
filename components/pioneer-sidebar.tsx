'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarTrigger,
} from '@/components/ui/sidebar';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
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
    <Button variant="ghost" size="sm" onClick={toggle} className="w-full justify-start gap-2">
      {dark ? (
        <>
          <SunIcon /> Modo claro
        </>
      ) : (
        <>
          <MoonIcon /> Modo oscuro
        </>
      )}
    </Button>
  );
}

// ════════════════════════════════════════
// ICONS (inline SVG — no extra deps)
// ════════════════════════════════════════

function SunIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="5" />
      <line x1="12" y1="1" x2="12" y2="3" />
      <line x1="12" y1="21" x2="12" y2="23" />
      <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
      <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
      <line x1="1" y1="12" x2="3" y2="12" />
      <line x1="21" y1="12" x2="23" y2="12" />
      <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
      <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
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
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  );
}

function BuildingIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="4" y="2" width="16" height="20" rx="2" ry="2" />
      <path d="M9 22v-4h6v4" />
      <path d="M8 6h.01" />
      <path d="M16 6h.01" />
      <path d="M8 10h.01" />
      <path d="M16 10h.01" />
      <path d="M8 14h.01" />
      <path d="M16 14h.01" />
    </svg>
  );
}

function LogOutIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <polyline points="16 17 21 12 16 7" />
      <line x1="21" y1="12" x2="9" y2="12" />
    </svg>
  );
}

function MapPinIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
      <circle cx="12" cy="10" r="3" />
    </svg>
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
            businessInfo: null, // Could be expanded later
            email: null,
          });
        }
      })
      .catch(() => {});
  }, []);

  const handleLogout = async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } catch {
      // Continue with client-side cleanup
    }
    localStorage.removeItem('pioneer_session_id');
    localStorage.removeItem('pioneer_dark_mode');
    router.push('/login');
  };

  const initials = sessionData?.businessName
    ? sessionData.businessName.split(' ').map(w => w[0]).join('').substring(0, 2).toUpperCase()
    : 'P';

  return (
    <Sidebar>
      {/* ═══ HEADER ═══ */}
      <SidebarHeader className="p-4">
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground text-sm font-bold">
            P
          </div>
          <div className="flex flex-col">
            <span className="text-sm font-semibold">Pioneer Agent</span>
            <span className="text-xs text-muted-foreground">Marketing con IA</span>
          </div>
        </div>
      </SidebarHeader>

      <Separator />

      <SidebarContent>
        {/* ═══ BUSINESS PROFILE ═══ */}
        {sessionData?.businessName && (
          <SidebarGroup>
            <SidebarGroupLabel>Su negocio</SidebarGroupLabel>
            <SidebarGroupContent>
              <div className="px-2 py-3">
                <div className="flex items-center gap-3">
                  <Avatar className="h-9 w-9">
                    <AvatarFallback className="bg-blue-100 text-blue-700 text-xs font-semibold">
                      {initials}
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex flex-col min-w-0">
                    <span className="text-sm font-medium truncate">
                      {sessionData.businessName}
                    </span>
                    {sessionData.businessInfo?.location && (
                      <span className="text-xs text-muted-foreground flex items-center gap-1">
                        <MapPinIcon />
                        {sessionData.businessInfo.location}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </SidebarGroupContent>
          </SidebarGroup>
        )}

        <Separator />

        {/* ═══ NAVIGATION ═══ */}
        <SidebarGroup>
          <SidebarGroupLabel>Navegación</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton
                  onClick={() => router.push('/chat')}
                  isActive={true}
                >
                  <MessageSquareIcon />
                  <span>Chat</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton
                  onClick={() => router.push('/onboarding')}
                >
                  <BuildingIcon />
                  <span>Perfil del negocio</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      {/* ═══ FOOTER ═══ */}
      <SidebarFooter className="p-2">
        <DarkModeToggle />
        <Button
          variant="ghost"
          size="sm"
          onClick={handleLogout}
          className="w-full justify-start gap-2 text-muted-foreground hover:text-destructive"
        >
          <LogOutIcon />
          Cerrar sesión
        </Button>
      </SidebarFooter>
    </Sidebar>
  );
}

// ════════════════════════════════════════
// EXPORT TRIGGER FOR MOBILE
// ════════════════════════════════════════

export { SidebarTrigger as PioneerSidebarTrigger };
