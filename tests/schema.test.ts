import { describe, it, expect } from "vitest";
import { getPrisma } from "@/lib/db";
import {
  AuditAction,
  AuditActorType,
  NotificationType,
  Role,
  SmsMessageType,
  SmsStatus,
} from "@/generated/prisma/client";

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

  it("can create and read SmsMessage and Notification (Task 7)", async () => {
    const prisma = getPrisma();

    const staff = await prisma.user.create({
      data: {
        name: "Receptionist",
        email: "receptionist-test@orthocare.com",
        passwordHash: "dummyhash",
        role: Role.RECEPTIONIST,
      },
    });

    const patient = await prisma.patient.create({
      data: {
        firstName: "Sara",
        lastName: "Haddad",
        phone: "0550777888",
        phoneE164: "+213550777888",
        preferredLocale: "ar",
      },
    });
    expect(patient.preferredLocale).toBe("ar");

    const service = await prisma.service.create({
      data: {
        slug: "msg-service",
        name: { fr: "Test", ar: "اختبار", en: "Test" },
        description: { fr: "Desc", ar: "وصف", en: "Desc" },
        durationMinutes: 30,
      },
    });

    const appointment = await prisma.appointment.create({
      data: {
        patientId: patient.id,
        serviceId: service.id,
        startTime: new Date("2026-08-29T10:00:00.000Z"),
        endTime: new Date("2026-08-29T10:30:00.000Z"),
      },
    });

    const sms = await prisma.smsMessage.create({
      data: {
        to: patient.phoneE164,
        body: "Bonjour Sara",
        patientId: patient.id,
        type: SmsMessageType.BOOKING_RECEIVED,
        provider: "mock",
        status: SmsStatus.SENT,
        appointmentId: appointment.id,
        sentAt: new Date(),
      },
    });
    expect(sms.type).toBe(SmsMessageType.BOOKING_RECEIVED);
    expect(sms.status).toBe(SmsStatus.SENT);

    const notification = await prisma.notification.create({
      data: {
        userId: staff.id,
        type: NotificationType.NEW_BOOKING,
        payload: { appointmentId: appointment.id, patientName: "Sara Haddad" },
      },
    });
    expect(notification.type).toBe(NotificationType.NEW_BOOKING);
    expect((notification.payload as { patientName: string }).patientName).toBe(
      "Sara Haddad",
    );

    // The unique (appointmentId, type) index rejects a duplicate automated send.
    await expect(
      prisma.smsMessage.create({
        data: {
          to: patient.phoneE164,
          body: "dup",
          patientId: patient.id,
          type: SmsMessageType.BOOKING_RECEIVED,
          provider: "mock",
          status: SmsStatus.SENT,
          appointmentId: appointment.id,
        },
      }),
    ).rejects.toThrow();
  });

  it("can create a Visit and read it back through patient.visits (Task 13)", async () => {
    const prisma = getPrisma();

    const staff = await prisma.user.create({
      data: {
        name: "Visit Author",
        email: "visit-staff-test@orthocare.com",
        passwordHash: "dummyhash",
        role: Role.RECEPTIONIST,
      },
    });

    const patient = await prisma.patient.create({
      data: {
        firstName: "Yacine",
        lastName: "Belkacem",
        phone: "0551223344",
        phoneE164: "+213551223344",
      },
    });

    const service = await prisma.service.create({
      data: {
        slug: "visit-service",
        name: { fr: "Detartrage", ar: "تنظيف", en: "Scaling" },
        description: { fr: "Desc", ar: "وصف", en: "Desc" },
        durationMinutes: 30,
      },
    });

    const visitDate = new Date("2026-03-14T09:00:00.000Z");
    const visit = await prisma.visit.create({
      data: {
        patientId: patient.id,
        date: visitDate,
        serviceId: service.id,
        type: "CONSULTATION",
        notes: "Note clinique synthetique",
        treatment: "Detartrage complet",
        createdById: staff.id,
      },
    });
    expect(visit.id).toBeDefined();

    // History = COMPLETED appointments UNION Visit rows (plan.md §Domain /
    // Data Model): the timeline query reads this relation.
    const withVisits = await prisma.patient.findUnique({
      where: { id: patient.id },
      include: { visits: true },
    });
    expect(withVisits?.visits).toHaveLength(1);
    expect(withVisits?.visits[0].id).toBe(visit.id);
    expect(withVisits?.visits[0].date.toISOString()).toBe(
      visitDate.toISOString(),
    );

    const fetched = await prisma.visit.findUnique({
      where: { id: visit.id },
      include: { service: true, createdBy: true },
    });
    expect(fetched?.service?.slug).toBe("visit-service");
    expect(fetched?.createdBy?.email).toBe("visit-staff-test@orthocare.com");

    // A walk-in recorded from the paper records has neither a catalogue
    // service nor a known author — both relations are optional on purpose.
    const walkIn = await prisma.visit.create({
      data: {
        patientId: patient.id,
        date: new Date("2025-11-02T08:30:00.000Z"),
        type: "URGENCE",
      },
    });
    expect(walkIn.serviceId).toBeNull();
    expect(walkIn.createdById).toBeNull();
    expect(await prisma.visit.count({ where: { patientId: patient.id } })).toBe(
      2,
    );

    // VISIT_CREATED is the audit action for a manually added visit; `detail`
    // carries ids and enums only, never the clinical note.
    const log = await prisma.auditLog.create({
      data: {
        actorType: AuditActorType.STAFF,
        userId: staff.id,
        action: AuditAction.VISIT_CREATED,
        entityType: "Visit",
        entityId: visit.id,
        detail: { patientId: patient.id, type: "CONSULTATION" },
      },
    });
    expect(log.action).toBe(AuditAction.VISIT_CREATED);
  });

  it("rejects a Visit whose patient does not exist (Task 13)", async () => {
    const prisma = getPrisma();

    // Also proves the per-test TRUNCATE ... CASCADE in tests/setup.ts reaches
    // "Visit" through its FK to "Patient", although the table is not named
    // there: the previous test left two rows behind.
    expect(await prisma.visit.count()).toBe(0);

    await expect(
      prisma.visit.create({
        data: {
          patientId: "does-not-exist",
          date: new Date("2026-03-14T09:00:00.000Z"),
          type: "AUTRE",
        },
      }),
    ).rejects.toThrow();
  });

  it("refuses to hard-delete a Patient that has a Visit (ON DELETE RESTRICT, Task 13)", async () => {
    const prisma = getPrisma();

    const patient = await prisma.patient.create({
      data: {
        firstName: "Nadia",
        lastName: "Restrict",
        phone: "0552334455",
        phoneE164: "+213552334455",
      },
    });

    await prisma.visit.create({
      data: {
        patientId: patient.id,
        date: new Date("2026-01-10T10:00:00.000Z"),
        type: "CONTROLE",
      },
    });

    // A patient with history must never be hard-deletable: erasure is the
    // soft path (`anonymizedAt`), never `prisma.patient.delete`. This is the
    // guarantee the schema header comment documents for `Visit.patient`.
    await expect(prisma.patient.delete({ where: { id: patient.id } })).rejects.toThrow();

    expect(await prisma.patient.count({ where: { id: patient.id } })).toBe(1);
  });

  it("attaches a PatientDocument to a Patient and reads it back through patient.documents (Task 15)", async () => {
    const prisma = getPrisma();

    const staff = await prisma.user.create({
      data: {
        name: "Document Uploader",
        email: "document-uploader-test@orthocare.com",
        passwordHash: "dummyhash",
        role: Role.RECEPTIONIST,
      },
    });

    const patient = await prisma.patient.create({
      data: {
        firstName: "Karim",
        lastName: "Amrani",
        phone: "0553445566",
        phoneE164: "+213553445566",
      },
    });

    // Every field is set explicitly, including the optional ones (deletedAt /
    // deletedById): a fixture that lets Prisma default fields to NULL cannot
    // catch a dropped column, so the assertions below would pass no matter
    // what the schema actually stores.
    const uploadedAt = new Date("2026-02-10T09:15:00.000Z");
    const blobKey = `patients/${patient.id}/radio-panoramique.jpg`;
    const document = await prisma.patientDocument.create({
      data: {
        patientId: patient.id,
        name: "radio-panoramique.jpg",
        mimeType: "image/jpeg",
        sizeBytes: 204800,
        blobKey,
        uploadedById: staff.id,
        uploadedAt,
        deletedAt: null,
        deletedById: null,
      },
    });
    expect(document.id).toBeDefined();

    const withDocuments = await prisma.patient.findUnique({
      where: { id: patient.id },
      include: { documents: true },
    });
    expect(withDocuments?.documents).toHaveLength(1);
    expect(withDocuments?.documents[0].id).toBe(document.id);
    expect(withDocuments?.documents[0].name).toBe("radio-panoramique.jpg");
    expect(withDocuments?.documents[0].mimeType).toBe("image/jpeg");
    expect(withDocuments?.documents[0].sizeBytes).toBe(204800);
    expect(withDocuments?.documents[0].blobKey).toBe(blobKey);
    expect(withDocuments?.documents[0].uploadedById).toBe(staff.id);
    expect(withDocuments?.documents[0].uploadedAt.toISOString()).toBe(
      uploadedAt.toISOString(),
    );
    expect(withDocuments?.documents[0].deletedAt).toBeNull();
    expect(withDocuments?.documents[0].deletedById).toBeNull();

    // Prove the named `uploadedBy` relation itself resolves, not just the
    // scalar `uploadedById` FK.
    const withUploader = await prisma.patientDocument.findUnique({
      where: { id: document.id },
      include: { uploadedBy: true },
    });
    expect(withUploader?.uploadedBy?.email).toBe(
      "document-uploader-test@orthocare.com",
    );
  });

  it("rejects a PatientDocument whose patientId does not exist (Task 15)", async () => {
    const prisma = getPrisma();

    // Also proves the per-test TRUNCATE ... CASCADE in tests/setup.ts reaches
    // "PatientDocument" through its FK to "Patient", although the table is
    // not named there: a leftover row from the previous test would make this
    // assertion fail.
    expect(await prisma.patientDocument.count()).toBe(0);

    let caught: unknown;
    try {
      await prisma.patientDocument.create({
        data: {
          patientId: "does-not-exist",
          name: "radio-panoramique.jpg",
          mimeType: "image/jpeg",
          sizeBytes: 204800,
          blobKey: "patients/does-not-exist/radio-panoramique.jpg",
        },
      });
    } catch (error) {
      caught = error;
    }

    // A specific Prisma FK-violation code, not just "something threw": a
    // missing-required-field bug would also throw, but with a different
    // code, and this test must not pass for the wrong reason.
    expect(caught).toBeDefined();
    expect((caught as { code?: string }).code).toBe("P2003");

    expect(await prisma.patientDocument.count()).toBe(0);
  });
});
