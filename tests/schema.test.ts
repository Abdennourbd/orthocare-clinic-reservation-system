import { describe, it, expect } from "vitest";
import { getPrisma } from "@/lib/db";
import { Role } from "@/generated/prisma/client";

describe("Schema smoke test (Task 3a)", () => {
  it("can create and read User, Patient, Service, and Appointment", async () => {
    const prisma = getPrisma();

    // 1. Create a User
    const user = await prisma.user.create({
      data: {
        name: "Test Admin",
        email: "admin-test@orthocare.com",
        passwordHash: "dummyhash",
        role: Role.ADMIN,
      },
    });
    expect(user.id).toBeDefined();
    expect(user.email).toBe("admin-test@orthocare.com");

    // 2. Create a Patient
    const patient = await prisma.patient.create({
      data: {
        firstName: "Jane",
        lastName: "Doe",
        phone: "0550998877",
        phoneE164: "+213550998877",
      },
    });
    expect(patient.id).toBeDefined();

    // 3. Create a Service
    const service = await prisma.service.create({
      data: {
        slug: "test-service",
        name: { fr: "Test", ar: "اختبار", en: "Test" },
        description: { fr: "Desc", ar: "وصف", en: "Desc" },
        durationMinutes: 30,
      },
    });
    expect(service.id).toBeDefined();

    // 4. Create an Appointment
    const startTime = new Date();
    const endTime = new Date(startTime.getTime() + 30 * 60000);
    const appointment = await prisma.appointment.create({
      data: {
        patientId: patient.id,
        serviceId: service.id,
        startTime,
        endTime,
      },
    });
    expect(appointment.id).toBeDefined();
    expect(appointment.status).toBe("PENDING");

    // Read back appointment with relations
    const fetched = await prisma.appointment.findUnique({
      where: { id: appointment.id },
      include: { patient: true, service: true },
    });
    expect(fetched?.patient.firstName).toBe("Jane");
    expect(fetched?.service.slug).toBe("test-service");
  });
});
