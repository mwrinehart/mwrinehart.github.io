"use client";

// Triggers the browser print dialog (used to save a certificate as PDF).
export function PrintButton() {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="rounded-lg bg-lc-purple px-4 py-2 text-sm font-semibold text-white hover:opacity-90 cursor-pointer"
    >
      Print / Save as PDF
    </button>
  );
}
