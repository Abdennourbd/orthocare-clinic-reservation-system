// Standard shadcn `cn` helper (clsx + tailwind-merge). Required by vendored
// registry components under src/components/ui (see components.json aliases).
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
