import { StudioNav } from "@/components/StudioNav";

export default function StudioLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <StudioNav />
      {children}
    </>
  );
}
