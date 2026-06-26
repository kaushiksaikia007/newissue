import type { Metadata } from "next";
import "./globals.css";
import Sidebar from "@/components/Sidebar";
import { TabProvider } from "@/components/TabProvider";
import { AuthProvider } from "@/components/AuthProvider";

export const metadata: Metadata = {
  title: "New Issue Bot — Markets Terminal",
  description:
    "Live macro dashboards and AI analysis across commodities and indices.",
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
          <TabProvider>
            <div className="app-shell">
              <Sidebar />
              <main className="app-main">{children}</main>
            </div>
          </TabProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
