import { PageMasthead } from "@/components/layout/page-masthead";
import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <div className="flex h-full flex-col">
      <PageMasthead eyebrow="Compose" title="New message" />
      <div className="flex-1 overflow-hidden px-4 py-4 md:px-6">
        <div className="mx-auto max-w-3xl space-y-4">
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-40 w-full" />
        </div>
      </div>
    </div>
  );
}
