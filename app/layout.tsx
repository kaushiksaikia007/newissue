import type { Metadata, Viewport } from "next";
import "./globals.css";
import Sidebar from "@/components/Sidebar";
import { TabProvider } from "@/components/TabProvider";
import { AuthProvider } from "@/components/AuthProvider";
import { WatchlistProvider } from "@/components/WatchlistProvider";
import { StrategyStoreProvider } from "@/components/StrategyStore";

export const metadata: Metadata = {
  title: "New Issue Bot — Markets Terminal",
  description:
    "Live macro dashboards and AI analysis across commodities and indices.",
};

// Mobile-first viewport: fit the device width, allow pinch-zoom (accessibility)
// and extend the dark theme into the iOS/Android status-bar safe areas.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#07090f",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <AuthProvider>
          <WatchlistProvider>
            <TabProvider>
              <StrategyStoreProvider>
                <div className="app-shell">
                  <Sidebar />
                  <main className="app-main">{children}</main>
                </div>
              </StrategyStoreProvider>
            </TabProvider>
          </WatchlistProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
