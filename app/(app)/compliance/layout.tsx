import { ComplianceNav } from "@/components/ComplianceNav";

export default function ComplianceLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <ComplianceNav />
      {children}
    </>
  );
}
