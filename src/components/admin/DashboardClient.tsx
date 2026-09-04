"use client";

import { useState } from "react";
import WeekAppointmentsStrip, { type WeekPatient } from "./WeekAppointmentsStrip";
import CallQueuePanel from "./CallQueuePanel";
import SmsPulsePanel from "./SmsPulsePanel";

// Client shell for the bento body: holds the week's unique patients once
// (WeekAppointmentsStrip reports them via onPatients) and feeds the SMS
// quick composer — one range fetch total, no extra patient search.

export default function DashboardClient({
  from,
  to,
  today,
}: {
  from: string;
  to: string;
  today: string;
}) {
  const [patients, setPatients] = useState<WeekPatient[]>([]);

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
      <div className="min-w-0 lg:col-span-8">
        <WeekAppointmentsStrip from={from} to={to} today={today} onPatients={setPatients} />
      </div>
      <div className="flex min-w-0 flex-col gap-4 lg:col-span-4">
        <CallQueuePanel />
        <SmsPulsePanel patients={patients} />
      </div>
    </div>
  );
}
