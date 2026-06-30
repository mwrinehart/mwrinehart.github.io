import { CampaignsNav } from "@/components/CampaignsNav";

export default function CampaignsLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <CampaignsNav />
      {children}
    </>
  );
}
