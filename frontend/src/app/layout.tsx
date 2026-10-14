import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "AI Prescription Optimization System | Clinical Decision Support",
  description:
    "Ensemble ML + TwoSIDES DDI Knowledge Graph + PID Safety Controller. " +
    "Investigational decision-support prototype for intelligent prescription optimization. " +
    "Not approved for clinical use — physician review required.",
  keywords: [
    "prescription optimization",
    "drug-drug interactions",
    "clinical decision support",
    "machine learning",
    "DDI",
    "TwoSIDES",
    "SafeDrug",
    "pharmacology",
  ],
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
