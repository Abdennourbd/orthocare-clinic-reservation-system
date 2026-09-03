import { getPrisma } from "../src/lib/db";
import { getClinicDayBoundsUTC, toClinicLocalDateString } from "../src/lib/time/clinicTime";

async function run() {
  const prisma = getPrisma();
  const patient = await prisma.patient.findFirst();
  const service = await prisma.service.findFirst();
  
  if (!patient || !service) {
    console.error("No patient or service found");
    return;
  }
  
  const todayDate = toClinicLocalDateString(new Date());
  const { startUTC } = getClinicDayBoundsUTC(todayDate);
  
  const startTime = new Date(startUTC.getTime() + 10 * 3600000); // 10:00 AM local
  const endTime = new Date(startUTC.getTime() + 10.5 * 3600000); // 10:30 AM local
  
  await prisma.appointment.create({
    data: {
      patientId: patient.id,
      serviceId: service.id,
      startTime,
      endTime,
      status: "CONFIRMED",
      source: "MANUAL"
    }
  });
  
  console.log("Created appointment for today at 10:00 AM local for broadcast test");
}
run().catch(console.error);
