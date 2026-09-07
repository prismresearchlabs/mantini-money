import type { Metadata } from "next";
import { ClerkProvider } from "@clerk/nextjs";
import "./globals.css";

export const metadata: Metadata = {
  title: "Mantini Money",
  description: "Your personal financial dashboard",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{process.env.NODE_ENV === "development" ? children : <ClerkProvider>{children}</ClerkProvider>}</body>
    </html>
  );
}
