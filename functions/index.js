const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { initializeApp }      = require("firebase-admin/app");
const { getAuth }            = require("firebase-admin/auth");
const { getFirestore }       = require("firebase-admin/firestore");

initializeApp();

/**
 * Сменя паролата на управителски акаунт.
 * Може да се извика само от Owner (role === "owner").
 *
 * data: { uid: string, newPassword: string }
 */
exports.resetUserPassword = onCall(
  { region: "europe-west1" },
  async (request) => {
    // 1. Трябва да е логнат
    if (!request.auth) {
      throw new HttpsError(
        "unauthenticated",
        "Трябва да сте влезли в системата."
      );
    }

    // 2. Само Owner може
    const db        = getFirestore();
    const callerDoc = await db.collection("users").doc(request.auth.uid).get();
    if (!callerDoc.exists || callerDoc.data().role !== "owner") {
      throw new HttpsError(
        "permission-denied",
        "Само Owner може да сменя пароли на управители."
      );
    }

    // 3. Валидация на входните данни
    const { uid, newPassword } = request.data;
    if (!uid || typeof uid !== "string") {
      throw new HttpsError("invalid-argument", "Липсва uid.");
    }
    if (!newPassword || newPassword.length < 6) {
      throw new HttpsError(
        "invalid-argument",
        "Паролата трябва да е поне 6 символа."
      );
    }

    // 4. Не позволявай смяна на Owner акаунт
    const targetDoc = await db.collection("users").doc(uid).get();
    if (targetDoc.exists && targetDoc.data().role === "owner") {
      throw new HttpsError(
        "permission-denied",
        "Не може да се сменя паролата на Owner акаунт."
      );
    }

    // 5. Смени паролата чрез Admin SDK
    await getAuth().updateUser(uid, { password: newPassword });

    return { success: true };
  }
);
