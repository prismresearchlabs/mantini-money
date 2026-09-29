import type { Metadata } from "next";
import localFont from "next/font/local";
import { ClerkProvider } from "@clerk/nextjs";
import "./globals.css";

const grotesk = localFont({
  src: [
    {
      path: "./fonts/fk-grotesk/FKGroteskTrial-Regular.otf",
      weight: "400",
      style: "normal",
    },
    {
      path: "./fonts/fk-grotesk/FKGroteskTrial-Medium.otf",
      weight: "500 600",
      style: "normal",
    },
    {
      path: "./fonts/fk-grotesk/FKGroteskTrial-Bold.otf",
      weight: "700 900",
      style: "normal",
    },
  ],
  variable: "--font-fk",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Mantini Money",
  description: "Your private financial workspace",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={grotesk.variable}>
      <body>
        {process.env.NODE_ENV === "development" ? children : <ClerkProvider>{children}</ClerkProvider>}
      </body>
    </html>
  );
}
