import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";

// Inter ships with the app (variable weights 100–900, Latin; SIL OFL, see fonts/LICENSE-inter.txt), so starting or
// building never depends on reaching Google Fonts.
const inter = localFont({
  src: "./fonts/inter-latin-variable.woff2",
  weight: "100 900",
  style: "normal",
  display: "swap",
  variable: "--font-inter",
});

export const metadata: Metadata = {
  title: { default: "Job Management System", template: "%s · Job Management" },
  description: "Applying management and interview scheduling",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={inter.variable}>
      <body className="font-sans antialiased">{children}</body>
    </html>
  );
}
