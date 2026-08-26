import { PrismaClient, Role } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import * as argon2 from "argon2";
import dotenv from "dotenv";

dotenv.config();

const pool = new Pool({ connectionString: process.env.DATABASE_URL! });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
  console.log("Seeding database (Task 3a & 3b)...");

  // 1. Create Admin User
  const adminPassword = process.env.ADMIN_INITIAL_PASSWORD;
  let adminUserId = null;
  if (!adminPassword || adminPassword.length < 12) {
    console.warn("ADMIN_INITIAL_PASSWORD must be at least 12 characters. Skipping admin user creation.");
  } else {
    const passwordHash = await argon2.hash(adminPassword);
    const admin = await prisma.user.upsert({
      where: { email: "admin@orthocare.com" },
      update: {},
      create: {
        name: "Admin User",
        email: "admin@orthocare.com",
        passwordHash,
        role: Role.ADMIN,
        mustChangePassword: true,
      },
    });
    adminUserId = admin.id;
    console.log(`Created admin user: ${admin.email}`);
  }

  // 2. Services (Expanded to real treatments + consultations)
  const services = [
    {
      slug: "consultation",
      name: { fr: "Consultation Initiale", ar: "استشارة أولية", en: "Initial Consultation" },
      description: { fr: "Premier rendez-vous", ar: "الموعد الأول", en: "First appointment" },
      durationMinutes: 30,
      price: 2000,
    },
    {
      slug: "controle",
      name: { fr: "Visite de contrôle", ar: "زيارة مراقبة", en: "Check-up visit" },
      description: { fr: "Suivi orthodontique régulier", ar: "متابعة تقويم الأسنان العادية", en: "Regular orthodontic follow-up" },
      durationMinutes: 15,
      price: 1500,
    },
    {
      slug: "urgence",
      name: { fr: "Urgence", ar: "حالة طوارئ", en: "Emergency" },
      description: { fr: "Appareil cassé, douleur", ar: "جهاز مكسور ، ألم", en: "Broken appliance, pain" },
      durationMinutes: 20,
      price: 0,
    },
    {
      slug: "detartrage",
      name: { fr: "Détartrage", ar: "إزالة الترسبات", en: "Teeth Cleaning" },
      description: { fr: "Nettoyage en profondeur", ar: "تنظيف عميق", en: "Deep cleaning" },
      durationMinutes: 45,
      price: 4000,
    },
    {
      slug: "blanchiment",
      name: { fr: "Blanchiment dentaire", ar: "تبييض الأسنان", en: "Teeth Whitening" },
      description: { fr: "Éclaircissement des dents", ar: "تفتيح الأسنان", en: "Teeth whitening" },
      durationMinutes: 60,
      price: 15000,
    },
    {
      slug: "couronnes-bridges",
      name: { fr: "Couronnes et bridges", ar: "تيجان وجسور", en: "Crowns and Bridges" },
      description: { fr: "Restauration esthétique", ar: "ترميم تجميلي", en: "Aesthetic restoration" },
      durationMinutes: 60,
      price: 25000,
    },
    {
      slug: "soins-radiculaires",
      name: { fr: "Soins dentaires et radiculaires", ar: "عناية بالأسنان والجذور", en: "Dental and Root Care" },
      description: { fr: "Traitement des caries et racines", ar: "علاج التسوس والجذور", en: "Caries and root treatment" },
      durationMinutes: 45,
      price: 5000,
    },
    {
      slug: "implants",
      name: { fr: "Implants dentaires", ar: "زراعة الأسنان", en: "Dental Implants" },
      description: { fr: "Remplacement esthétique et durable", ar: "استبدال تجميلي ودائم", en: "Aesthetic and durable replacement" },
      durationMinutes: 60,
      price: 60000,
    },
    {
      slug: "orthodontie-brackets",
      name: { fr: "Orthodontie (brackets classiques)", ar: "تقويم الأسنان (أقواس كلاسيكية)", en: "Orthodontics (Classic Braces)" },
      description: { fr: "Alignement des dents avec appareils fixes", ar: "محاذاة الأسنان بأجهزة ثابتة", en: "Teeth alignment with fixed appliances" },
      durationMinutes: 45,
      price: 0,
    },
    {
      slug: "orthodontie-pitts",
      name: { fr: "Orthodontie (PITTS Protocol)", ar: "تقويم الأسنان (بروتوكول بيتس)", en: "Orthodontics (PITTS Protocol)" },
      description: { fr: "Système à faible friction", ar: "نظام احتكاك منخفض", en: "Low friction system" },
      durationMinutes: 45,
      price: 0,
    },
    {
      slug: "aligneurs",
      name: { fr: "Aligneurs transparents", ar: "مصففات شفافة", en: "Clear Aligners" },
      description: { fr: "Gouttières discrètes", ar: "مصففات غير مرئية", en: "Discreet clear aligners" },
      durationMinutes: 45,
      price: 0,
    }
  ];

  for (const s of services) {
    await prisma.service.upsert({
      where: { slug: s.slug },
      update: s,
      create: s,
    });
  }
  console.log(`Created/Updated ${services.length} services.`);

  // 3. Create a Patient
  const patient = await prisma.patient.upsert({
    where: { id: "seed-patient-1" },
    update: {},
    create: {
      id: "seed-patient-1",
      firstName: "Amine",
      lastName: "Benali",
      phone: "0550123456",
      phoneE164: "+213550123456",
      email: "amine@example.com",
    },
  });
  console.log(`Created patient: ${patient.firstName} ${patient.lastName}`);

  // 4. Settings
  const settings = [
    {
      key: "workingHours",
      value: {
        sat: { open: "10:00", close: "17:00" },
        sun: { open: "10:00", close: "17:00" },
        mon: { open: "10:00", close: "17:00" },
        tue: { open: "10:00", close: "17:00" },
        wed: { open: "10:00", close: "17:00" },
        thu: { open: "10:00", close: "17:00" },
        fri: { closed: true }
      }
    },
    {
      key: "bookingPolicy",
      value: {
        pendingExpiryHours: 24,
        minLeadTimeMinutes: 120,
        maxHorizonDays: 90,
        clinicTimezone: "Africa/Algiers"
      }
    },
    {
      key: "slotConfig",
      value: {
        granularityMinutes: 15,
        bufferMinutes: 5,
        // null = no lunch closure. Shape when set: { start: "13:00", end: "14:00" }
        // (clinic-local HH:mm). Task 4's slot engine reads this key.
        lunchBreak: null
      }
    },
    {
      key: "consentVersion",
      value: "1.0"
    },
    {
      // Clinic identity shown on the self-service token page (minimum
      // disclosure) and on the contact page. Editable from the dashboard.
      key: "clinicInfo",
      value: {
        name: "Ortho'Care Clinic",
        address: "Alger, Algérie",
        phone: "0550 12 34 56"
      }
    },
    {
      // Messaging templates (Task 7/8). French-only for now; the booking-received
      // message is a REQUEST — the clinic still calls to confirm. The
      // confirmation/reschedule messages carry the self-service link
      // ({selfServiceLink}). Editable from the dashboard (Task 21).
      key: "messageTemplates",
      value: {
        bookingReceived: "Bonjour {firstName}, votre demande de rendez-vous {serviceName} le {date} à {time} a bien été reçue. La clinique vous appellera au {phone} pour la confirmer. Ortho'Care Clinic",
        confirmation: "Bonjour {firstName}, votre rendez-vous {serviceName} le {date} à {time} est confirmé. Pour le déplacer ou l'annuler : {selfServiceLink} Ortho'Care Clinic",
        cancelled: "Bonjour {firstName}, votre rendez-vous {serviceName} du {date} à {time} a été annulé. Ortho'Care Clinic",
        reschedule: "Bonjour {firstName}, votre rendez-vous {serviceName} a été déplacé du {oldDate} à {oldTime} au {newDate} à {newTime}. Pour le gérer : {selfServiceLink} Ortho'Care Clinic",
        reminder: "Bonjour {firstName}, rappel : votre rendez-vous {serviceName} du {date} à {time}. Ortho'Care Clinic",
        noShow: "Bonjour {firstName}, vous n'êtes pas venu à votre rendez-vous {serviceName} du {date} à {time}. Pour le reprogrammer, appelez la clinique. Ortho'Care Clinic",
        expired: "Bonjour {firstName}, votre demande de rendez-vous {serviceName} du {date} à {time} n'a pas été confirmée à temps et a été annulée. Contactez la clinique pour reprendre rendez-vous. Ortho'Care Clinic"
      }
    }
  ];

  for (const s of settings) {
    await prisma.setting.upsert({
      where: { key: s.key },
      update: { value: s.value },
      create: { key: s.key, value: s.value }
    });
  }
  console.log("Seeded settings.");

  // 5. Testimonials (From actual clinic)
  const testimonials = [
    {
      key: "t1",
      author: { fr: "Maman d'un patient", ar: "أم لمريض", en: "Mother of a patient" },
      content: { 
        fr: "Je n'ai pas les mots pour remercier Dr. Moussaoui et son équipe. Mon fils de 9 ans avait une phobie des dentistes mais avec Dr. Moussaoui et son assistante souriante c'est comme par magie il n'a plus peur. Que dieu vous bénisse ❤️",
        ar: "لا أجد الكلمات لأشكر الدكتورة موساوي وفريقها. ابني البالغ من العمر 9 سنوات كان يخاف من أطباء الأسنان ولكن بفضلها لم يعد خائفاً. بارك الله فيكم ❤️",
        en: "I don't have the words to thank Dr. Moussaoui and her team. My 9-year-old son had a phobia of dentists but with her, it's like magic, he is no longer afraid. God bless you ❤️"
      },
      rating: 5
    },
    {
      key: "t2",
      author: { fr: "Patient anonyme", ar: "مريض مجهول", en: "Anonymous Patient" },
      content: {
        fr: "Cabinet sérieux et professionnel, qualité service et excellente propreté. Mes enfants ont été très bien pris en charge. Le médecin et le personnel sont magnifiques.",
        ar: "عيادة جادة ومحترفة، جودة خدمة ونظافة ممتازة. تم الاعتناء بأطفالي بشكل جيد للغاية. الطبيبة والموظفون رائعون.",
        en: "Serious and professional clinic, quality service and excellent cleanliness. My children were very well taken care of. The doctor and staff are magnificent."
      },
      rating: 5
    },
    {
      key: "t3",
      author: { fr: "Patient(e)", ar: "مريض(ة)", en: "Patient" },
      content: {
        fr: "J'ai eu une excellente expérience avec Dr. Moussaoui et son équipe. Très professionnels, gentils, et m'ont toujours mis à l'aise. La clinique est propre, moderne et bien organisée. Je suis très heureuse des résultats !",
        ar: "كانت لي تجربة رائعة مع د. موساوي وفريقها. محترفون ولطفاء ويجعلونني دائماً أشعر بالراحة. العيادة نظيفة وحديثة ومنظمة. أنا سعيدة جداً بالنتائج!",
        en: "I had a great experience with dr moussaoui and their team, they are very professional, kind, and always made me feel comfortable during my visits, the clinic is clean, modern, and well organized, I'm really happy with the results of my treatment."
      },
      rating: 5
    },
    {
      key: "t4",
      author: { fr: "Patient(e)", ar: "مريض(ة)", en: "Patient" },
      content: {
        fr: "Nous tenons à vous remercier sincèrement pour l'excellent suivi et le soin apporté tout au long du traitement de ma fille. Votre patience, professionnalisme et gentillesse ont fait la différence. Nous sommes très satisfaits des résultats.",
        ar: "نود أن نشكركم بصدق على المتابعة والرعاية الممتازة طوال فترة علاج ابنتي. صبركم واحترافكم ولطفكم أحدثوا فرقاً. نحن راضون جداً عن النتائج.",
        en: "We sincerely want to thank you for the excellent follow-up and care provided throughout my daughter's treatment. Your patience, professionalism, and kindness really made a difference. We are very satisfied with the results."
      },
      rating: 5
    },
    {
      key: "t5",
      author: { fr: "Patient(e)", ar: "مريض(ة)", en: "Patient" },
      content: {
        fr: "Honnêtement, c'est une excellente doctoresse, et le service également. L'une des rares qui travaillent professionnellement. Merci ❤️",
        ar: "بصراحة، هي طبيبة ممتازة والخدمة أيضاً. واحدة من القلائل الذين يعملون باحترافية. شكراً ❤️",
        en: "Honestly, she is an excellent doctor. And the service as well. One of the few who work professionally. Thank u ❤️"
      },
      rating: 5
    }
  ];

  for (const t of testimonials) {
    await prisma.testimonial.upsert({
      where: { key: t.key },
      update: t,
      create: t
    });
  }
  console.log(`Seeded ${testimonials.length} testimonials.`);

  // 6. FAQ (From actual clinic)
  const faqs = [
    {
      key: "f1",
      question: {
        fr: "A partir de quel âge doit se faire la consultation orthodontique?",
        ar: "من أي عمر يجب إجراء استشارة تقويم الأسنان؟",
        en: "At what age should an orthodontic consultation take place?"
      },
      answer: {
        fr: "C'est généralement à partir de 6, 7 ans, lorsque les premières dents définitives font leur apparition. Cependant, dans certains cas, la consultation peut se faire un peu plus tôt.",
        ar: "عادةً ما يكون ذلك ابتداءً من عمر 6، 7 سنوات، عندما تبدأ الأسنان الدائمة الأولى في الظهور. ومع ذلك، في بعض الحالات، يمكن إجراء الاستشارة في وقت أبكر قليلاً.",
        en: "It is generally from 6, 7 years old, when the first permanent teeth appear. However, in some cases, the consultation can be done a little earlier."
      }
    },
    {
      key: "f2",
      question: {
        fr: "Quelle est la durée du traitement orthodontique ?",
        ar: "كم مدة علاج تقويم الأسنان؟",
        en: "How long is the orthodontic treatment?"
      },
      answer: {
        fr: "La durée du traitement orthodontique dépend de la complexité du cas, de l'âge du patient, de la technique utilisée et surtout la coopération du patient.",
        ar: "تعتمد مدة علاج تقويم الأسنان على مدى تعقيد الحالة، وعمر المريض، والتقنية المستخدمة، وخاصة تعاون المريض.",
        en: "The duration of orthodontic treatment depends on the complexity of the case, the patient's age, the technique used, and above all the patient's cooperation."
      }
    },
    {
      key: "f3",
      question: {
        fr: "Est-il nécessaire de mettre des brackets sur les deux arcades (haut et bas)?",
        ar: "هل من الضروري وضع الأقواس على كلا الفكين (العلوي والسفلي)؟",
        en: "Is it necessary to put brackets on both arches (upper and lower)?"
      },
      answer: {
        fr: "Oui, il est absolument nécessaire de traiter les deux arcades simultanément, et ce pour avoir une occlusion fonctionnelle.",
        ar: "نعم، من الضروري تماماً علاج كلا الفكين في وقت واحد، وذلك من أجل الحصول على إطباق وظيفي سليم.",
        en: "Yes, it is absolutely necessary to treat both arches simultaneously in order to have functional occlusion."
      }
    },
    {
      key: "f4",
      question: {
        fr: "Est-ce que le traitement orthodontique est douloureux ?",
        ar: "هل علاج تقويم الأسنان مؤلم؟",
        en: "Is orthodontic treatment painful?"
      },
      answer: {
        fr: "La pose des brackets n'est absolument pas douloureuse. Cependant durant les heures ou les jours qui suivent la pose ou l'activation de l'appareil, le patient peut ressentir une pression ou des douleurs qui disparaissent au bout de quelque temps.",
        ar: "وضع الأقواس ليس مؤلماً على الإطلاق. ومع ذلك، خلال الساعات أو الأيام التي تلي وضع أو تنشيط الجهاز، قد يشعر المريض بضغط أو ألم يختفي بعد فترة من الوقت.",
        en: "Fitting the brackets is absolutely not painful. However, during the hours or days following the fitting or activation of the appliance, the patient may feel pressure or pain which disappears after some time."
      }
    },
    {
      key: "f5",
      question: {
        fr: "Quels sont les aliments interdits lorsqu'on porte un appareil dentaire?",
        ar: "ما هي الأطعمة الممنوعة عند ارتداء تقويم الأسنان؟",
        en: "What foods are prohibited when wearing braces?"
      },
      answer: {
        fr: "Les aliments collants (chewing-gum, bonbons), les aliments durs (noix, amandes). Il est interdit de croquer des fruits ou légumes crus; il faudra découper de petits morceaux et mâcher doucement.",
        ar: "الأطعمة اللزجة (العلكة، الحلوى)، والأطعمة الصلبة (المكسرات، اللوز). يُمنع قضم الفواكه أو الخضار النيئة؛ يجب تقطيعها إلى قطع صغيرة والمضغ ببطء.",
        en: "Sticky foods (chewing gum, sweets), hard foods (nuts, almonds). It is forbidden to bite into raw fruits or vegetables; you will need to cut small pieces and chew slowly."
      }
    }
  ];

  for (const f of faqs) {
    await prisma.faqItem.upsert({
      where: { key: f.key },
      update: f,
      create: f
    });
  }
  console.log(`Seeded ${faqs.length} FAQs.`);

  // 7. ScheduleException (Holiday example)
  if (adminUserId) {
    const nextYear = new Date().getFullYear() + 1;
    // Clinic-local day boundaries (Africa/Algiers = UTC+1, no DST). A full-day
    // closure runs from local 00:00 to local 23:59:59; these are stored as UTC.
    // Constructing the local range explicitly avoids the classic silent
    // one-hour drift between UTC and clinic time (see plan.md "Timezone").
    const startDate = new Date(`${nextYear}-01-01T00:00:00+01:00`);
    const endDate = new Date(`${nextYear}-01-01T23:59:59+01:00`);

    // Check if it exists by dates to prevent duplicates (since we don't have a unique key)
    const existingHoliday = await prisma.scheduleException.findFirst({
      where: { startDate, endDate }
    });
    
    if (!existingHoliday) {
      await prisma.scheduleException.create({
        data: {
          startDate,
          endDate,
          allDay: true,
          reason: { fr: "Nouvel An", ar: "رأس السنة", en: "New Year" },
          createdById: adminUserId
        }
      });
      console.log(`Seeded example ScheduleException for New Year ${nextYear}.`);
    }
  } else {
    console.warn("No admin user created — skipping ScheduleException seed.");
  }

  console.log("Seed completed successfully.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
