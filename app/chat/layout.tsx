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
          {/* Mobile trigger */}
          <div className="md:hidden flex items-center p-2 border-b">
            <PioneerSidebarTrigger />
            <span className="ml-2 text-sm font-semibold">Pioneer Agent</span>
          </div>
          {children}
        </main>
      </div>
    </SidebarProvider>
  );
}
