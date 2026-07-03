import { LmsNav } from "@/components/LmsNav";

export default function LmsLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <LmsNav />
      {children}
    </>
  );
}
