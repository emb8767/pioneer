import { SidebarProvider } from '@/components/ui/sidebar';
import { PioneerSidebar, PioneerSidebarTrigger } from '@/components/pioneer-sidebar';

export default function ChatLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <SidebarProvider>
      <div className="flex h-screen w-full">
        <PioneerSidebar />
        <main className="flex-1 flex flex-col min-w-0">
          {/* Mobile header */}
          <div className="md:hidden flex items-center gap-3 px-3 py-2.5 border-b border-border bg-background/80 backdrop-blur-sm">
            <PioneerSidebarTrigger />
            <div className="flex items-center gap-2">
              <div className="h-6 w-6 rounded-lg pioneer-gradient flex items-center justify-center">
                <span className="text-white text-[10px] font-bold">P</span>
              </div>
              <span className="text-sm font-semibold text-foreground">Pioneer Agent</span>
            </div>
          </div>
          {children}
        </main>
      </div>
    </SidebarProvider>
  );
}
