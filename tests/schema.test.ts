import { describe, it, expect } from "vitest";
import { getPrisma } from "@/lib/db";
import { Role } from "@/generated/prisma/client";

// Per-locale fields are stored as JSON columns; narrow them to a known shape.
type LocaleObject = { fr?: string; ar?: string; en?: string };
type LocaleMap = { [key: string]: LocaleObject };

const asLocales = (value: unknown): LocaleMap => value as LocaleMap;

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

  it("can create and read the Task 3b content models", async () => {
    const prisma = getPrisma();

    // A ScheduleException requires a User for createdById.
    const user = await prisma.user.create({
      data: {
        name: "Content Admin",
        email: "content-admin-test@orthocare.com",
        passwordHash: "dummyhash",
        role: Role.ADMIN,
      },
    });

    const setting = await prisma.setting.create({
      data: {
        key: "workingHours",
        value: {
          sat: { open: "10:00", close: "17:00" },
          fri: { closed: true },
        },
      },
    });
    expect(setting.key).toBe("workingHours");
    const workingHours = setting.value as {
      sat: { open: string; close: string };
      fri: { closed: boolean };
    };
    expect(workingHours.fri.closed).toBe(true);

    const startDate = new Date("2027-01-01T00:00:00+01:00");
    const endDate = new Date("2027-01-01T23:59:59+01:00");
    const closure = await prisma.scheduleException.create({
      data: {
        startDate,
        endDate,
        allDay: true,
        reason: { fr: "Nouvel An", ar: "رأس السنة", en: "New Year" },
        createdById: user.id,
      },
    });
    expect(closure.allDay).toBe(true);
    expect(closure.startDate.toISOString()).toBe(
      new Date("2027-01-01T00:00:00+01:00").toISOString(),
    );

    const testimonial = await prisma.testimonial.create({
      data: {
        key: "t-test",
        author: { fr: "Patient(e)", ar: "مريض(ة)", en: "Patient" },
        content: { fr: "Excellente", ar: "ممتازة", en: "Excellent" },
        rating: 5,
      },
    });
    expect(asLocales(testimonial.content).ar).toBe("ممتازة");

    const faq = await prisma.faqItem.create({
      data: {
        key: "f-test",
        question: { fr: "Question", ar: "سؤال", en: "Question" },
        answer: { fr: "Réponse", ar: "جواب", en: "Answer" },
      },
    });
    expect(asLocales(faq.question).en).toBe("Question");

    const gallery = await prisma.galleryItem.create({
      data: {
        key: "g-test",
        imageUrl: "https://example.com/photo.jpg",
        caption: { fr: "Photo", ar: "صورة", en: "Photo" },
      },
    });
    expect(gallery.imageUrl).toBe("https://example.com/photo.jpg");

    // Read back the closure with its creator relation.
    const fetched = await prisma.scheduleException.findUnique({
      where: { id: closure.id },
      include: { createdBy: true },
    });
    expect(fetched?.createdBy.email).toBe("content-admin-test@orthocare.com");
  });
});
